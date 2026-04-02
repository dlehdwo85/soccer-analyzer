"""
고급 분석 서비스
=================
유튜브 영상 (KVw_kDe_KaM) 기준:
  - 홈팀: 하늘색 상의
  - 어웨이: 빨강 상의
  - 심판: 노랑 상의

신규 기능:
  1. 팀 포메이션 자동 감지 (4-4-2, 4-3-3, 3-5-2 등)
  2. 9구역 공간 점유율 히트맵
  3. 압박 강도 지수 (시간대별)
  4. 팀 무게중심 이동 타임라인
  5. 피로도 누적 지수
  6. 선수 역할 자동 분류 (공격수/수비수/플메/윙어)
  7. 스프린트 감지
  8. AI 경기 총평 자동 생성
"""

import json
import math
import random
import numpy as np
from typing import List, Dict, Tuple, Any


# ══════════════════════════════════════════════════
#  색상 기반 팀 감지 (유튜브 영상 기준)
#  실제 영상 연동 시 이 함수를 OpenCV로 교체
# ══════════════════════════════════════════════════

# 유튜브 영상 색상 HSV 범위 정의
COLOR_PROFILES = {
    "sky_blue_home": {  # 하늘색 홈팀
        "lower": [85, 100, 150],
        "upper": [110, 255, 255],
        "team": "home"
    },
    "red_away": {       # 빨강 어웨이
        "lower1": [0, 120, 100],
        "upper1": [10, 255, 255],
        "lower2": [160, 120, 100],
        "upper2": [180, 255, 255],
        "team": "away"
    },
    "yellow_ref": {     # 노랑 심판
        "lower": [20, 100, 150],
        "upper": [35, 255, 255],
        "team": "referee"
    },
    # 원본 영상(팟플레이어 녹화) 색상
    "sky_blue_original": {
        "lower": [38, 50, 100],
        "upper": [55, 130, 180],
        "team": "home"
    },
    "striped_away": {   # 줄무늬 어웨이 (네이비)
        "lower": [100, 40, 20],
        "upper": [130, 180, 120],
        "team": "away"
    },
    "red_referee": {    # 빨강 심판 (원본)
        "lower1": [0, 80, 80],
        "upper1": [12, 255, 255],
        "lower2": [155, 80, 80],
        "upper2": [180, 255, 255],
        "team": "referee"
    }
}


# ══════════════════════════════════════════════════
#  1. 포메이션 감지
# ══════════════════════════════════════════════════

def detect_formation(positions: List[Tuple[float, float]]) -> str:
    """
    선수 평균 위치로 포메이션 추정.
    positions: [(x, y), ...] 정규화 좌표
    """
    if len(positions) < 7:
        return "알 수 없음"

    # Y축(상하)으로 선수 정렬 후 라인별 분류
    sorted_pos = sorted(positions, key=lambda p: p[1])
    n = len(sorted_pos)

    # 골키퍼 제외 (가장 뒤에 있는 1명)
    field_players = sorted_pos[:-1] if n > 1 else sorted_pos

    # Y축 기준 3~4구간으로 분류
    y_vals = [p[1] for p in field_players]
    if not y_vals:
        return "4-4-2"

    y_min, y_max = min(y_vals), max(y_vals)
    y_range = y_max - y_min if y_max > y_min else 0.1

    lines = {"def": 0, "mid": 0, "att": 0}
    for _, y in field_players:
        rel = (y - y_min) / y_range
        if rel < 0.33:
            lines["att"] += 1
        elif rel < 0.66:
            lines["mid"] += 1
        else:
            lines["def"] += 1

    d, m, a = lines["def"], lines["mid"], lines["att"]

    # 포메이션 매칭
    formations = {
        (4, 4, 2): "4-4-2",
        (4, 3, 3): "4-3-3",
        (3, 5, 2): "3-5-2",
        (4, 2, 4): "4-2-4",
        (5, 3, 2): "5-3-2",
        (3, 4, 3): "3-4-3",
        (4, 5, 1): "4-5-1",
    }
    # 가장 가까운 포메이션 찾기
    best = "4-4-2"
    best_diff = float('inf')
    for (fd, fm, fa), name in formations.items():
        diff = abs(d - fd) + abs(m - fm) + abs(a - fa)
        if diff < best_diff:
            best_diff = diff
            best = name

    return best


# ══════════════════════════════════════════════════
#  2. 9구역 공간 점유율
# ══════════════════════════════════════════════════

ZONE_NAMES = {
    (0, 0): "좌측 수비", (1, 0): "중앙 수비", (2, 0): "우측 수비",
    (0, 1): "좌측 미드", (1, 1): "중앙 미드", (2, 1): "우측 미드",
    (0, 2): "좌측 공격", (1, 2): "중앙 공격", (2, 2): "우측 공격",
}

def calc_zone_map(trajectories: List[Tuple[float, float]]) -> Dict[str, float]:
    """9구역 점유율 계산 (%)"""
    zone_counts = {}
    for col in range(3):
        for row in range(3):
            zone_counts[(col, row)] = 0

    for x, y in trajectories:
        col = min(int(x * 3), 2)
        row = min(int(y * 3), 2)
        zone_counts[(col, row)] += 1

    total = sum(zone_counts.values()) or 1
    return {
        ZONE_NAMES[(c, r)]: round(v / total * 100, 1)
        for (c, r), v in zone_counts.items()
    }


# ══════════════════════════════════════════════════
#  3. 압박 강도 지수
# ══════════════════════════════════════════════════

def calc_press_intensity(
    home_positions: List[Tuple[float, float]],
    away_positions: List[Tuple[float, float]],
    press_threshold: float = 0.15,
) -> Dict[str, float]:
    """
    압박 강도 = 상대 선수와 일정 거리 이내에 있는 횟수 비율.
    press_threshold: 경기장 기준 거리 (0~1)
    """
    home_press = 0
    away_press = 0
    total = max(len(home_positions), len(away_positions), 1)

    for hx, hy in home_positions:
        for ax, ay in away_positions:
            dist = math.sqrt((hx - ax) ** 2 + (hy - ay) ** 2)
            if dist < press_threshold:
                home_press += 1
                break

    for ax, ay in away_positions:
        for hx, hy in home_positions:
            dist = math.sqrt((ax - hx) ** 2 + (ay - hy) ** 2)
            if dist < press_threshold:
                away_press += 1
                break

    return {
        "home_press_rate": round(home_press / total * 100, 1),
        "away_press_rate": round(away_press / total * 100, 1),
    }


# ══════════════════════════════════════════════════
#  4. 팀 무게중심 (centroid) 타임라인
# ══════════════════════════════════════════════════

def calc_centroid_timeline(
    frame_data: List[Dict],
    team: str,
    interval_sec: float = 5.0,
    fps: float = 30.0,
) -> List[Dict]:
    """
    N초 단위로 팀 무게중심 위치 계산.
    Returns: [{"time": 5, "x": 0.4, "y": 0.6}, ...]
    """
    timeline = []
    interval_frames = int(interval_sec * fps)
    max_frame = max((d["frame_index"] for d in frame_data), default=0)

    for start in range(0, max_frame, interval_frames):
        end = start + interval_frames
        pts = [
            (d["x"], d["y"]) for d in frame_data
            if d["team_side"] == team and start <= d["frame_index"] < end
        ]
        if pts:
            cx = round(sum(p[0] for p in pts) / len(pts), 3)
            cy = round(sum(p[1] for p in pts) / len(pts), 3)
            timeline.append({
                "time": round(start / fps, 1),
                "x": cx,
                "y": cy,
            })

    return timeline


# ══════════════════════════════════════════════════
#  5. 피로도 타임라인
# ══════════════════════════════════════════════════

def calc_fatigue_timeline(
    player_frames: List[Dict],
    fps: float = 30.0,
    window_sec: float = 10.0,
) -> List[Dict]:
    """
    10초 단위 이동속도로 피로도 계산.
    피로도 = 초반 속도 대비 현재 속도 감소율
    """
    window = int(window_sec * fps)
    timeline = []

    sorted_frames = sorted(player_frames, key=lambda d: d["frame_index"])
    if len(sorted_frames) < 2:
        return []

    speeds = []
    for i in range(1, len(sorted_frames)):
        dx = (sorted_frames[i]["x"] - sorted_frames[i-1]["x"]) * 105
        dy = (sorted_frames[i]["y"] - sorted_frames[i-1]["y"]) * 68
        dt = (sorted_frames[i]["frame_index"] - sorted_frames[i-1]["frame_index"]) / fps
        if dt > 0:
            speeds.append(math.sqrt(dx**2 + dy**2) / dt)

    if not speeds:
        return []

    baseline = sum(speeds[:max(len(speeds)//5, 1)]) / max(len(speeds)//5, 1)

    chunk = max(len(speeds) // 9, 1)
    for i in range(0, len(speeds), chunk):
        seg = speeds[i:i+chunk]
        if seg:
            avg_speed = sum(seg) / len(seg)
            fatigue = max(0, round((1 - avg_speed / baseline) * 100, 1)) if baseline > 0 else 0
            timeline.append({
                "time": round(i / fps * chunk, 1),
                "fatigue": min(fatigue, 100),
                "speed": round(avg_speed, 2),
            })

    return timeline


# ══════════════════════════════════════════════════
#  6. 선수 역할 자동 분류
# ══════════════════════════════════════════════════

def classify_role(
    avg_x: float,
    avg_y: float,
    active_score: float,
    total_distance_m: float,
    zone_map: Dict,
) -> Tuple[str, str]:
    """
    선수 역할과 배지 자동 분류.
    Returns: (role_type, style_badge)
    """
    # 포지션 기반 역할
    if avg_y < 0.30:
        base_role = "공격수"
    elif avg_y < 0.50:
        base_role = "공격형미드"
    elif avg_y < 0.70:
        base_role = "수비형미드"
    else:
        base_role = "수비수"

    # 좌우 편향 확인
    if avg_x < 0.30:
        lateral = "좌측 "
    elif avg_x > 0.70:
        lateral = "우측 "
    else:
        lateral = "중앙 "

    role_type = lateral + base_role

    # 스타일 배지
    if total_distance_m > 10000:
        badge = "활동량형"
    elif active_score > 70:
        badge = "넓은커버"
    elif avg_x < 0.30:
        badge = "좌측윙어"
    elif avg_x > 0.70:
        badge = "우측윙어"
    elif avg_y < 0.35:
        badge = "공격형"
    elif avg_y > 0.65:
        badge = "수비형"
    else:
        badge = "플메이커"

    return role_type, badge


# ══════════════════════════════════════════════════
#  7. 스프린트 감지
# ══════════════════════════════════════════════════

SPRINT_SPEED_MPS = 5.5  # 스프린트 기준 속도 (m/s)

def count_sprints(frames: List[Dict], fps: float = 30.0) -> int:
    """연속 고속 이동 구간을 스프린트로 감지."""
    sprint_count = 0
    in_sprint = False

    sorted_frames = sorted(frames, key=lambda d: d["frame_index"])

    for i in range(1, len(sorted_frames)):
        dx = (sorted_frames[i]["x"] - sorted_frames[i-1]["x"]) * 105
        dy = (sorted_frames[i]["y"] - sorted_frames[i-1]["y"]) * 68
        dt = (sorted_frames[i]["frame_index"] - sorted_frames[i-1]["frame_index"]) / fps
        speed = math.sqrt(dx**2 + dy**2) / dt if dt > 0 else 0

        if speed >= SPRINT_SPEED_MPS:
            if not in_sprint:
                sprint_count += 1
                in_sprint = True
        else:
            in_sprint = False

    return sprint_count


# ══════════════════════════════════════════════════
#  8. AI 경기 총평 생성
# ══════════════════════════════════════════════════

def generate_match_summary(
    home_name: str,
    away_name: str,
    home_formation: str,
    away_formation: str,
    home_dist: float,
    away_dist: float,
    home_press: float,
    away_press: float,
    home_zone: Dict,
    away_zone: Dict,
) -> str:
    """규칙 기반 경기 총평 생성 (추후 LLM 교체 가능)."""
    parts = []

    # 활동량 비교
    if home_dist > away_dist * 1.1:
        parts.append(f"{home_name}이 총 이동거리에서 우위를 보이며 체력적으로 앞섰습니다.")
    elif away_dist > home_dist * 1.1:
        parts.append(f"{away_name}이 더 활발한 움직임으로 경기를 주도했습니다.")
    else:
        parts.append(f"양팀의 총 이동거리가 비슷하여 체력적으로 균형 잡힌 경기였습니다.")

    # 포메이션
    parts.append(f"{home_name}은 {home_formation} 포메이션, {away_name}은 {away_formation} 포메이션으로 경기했습니다.")

    # 압박
    if home_press > away_press + 10:
        parts.append(f"{home_name}의 적극적인 압박이 돋보였습니다.")
    elif away_press > home_press + 10:
        parts.append(f"{away_name}의 조직적인 압박이 경기 흐름을 이끌었습니다.")

    # 공간 활용
    home_attack_pct = home_zone.get("좌측 공격", 0) + home_zone.get("중앙 공격", 0) + home_zone.get("우측 공격", 0)
    away_attack_pct = away_zone.get("좌측 공격", 0) + away_zone.get("중앙 공격", 0) + away_zone.get("우측 공격", 0)

    if home_attack_pct > 40:
        parts.append(f"{home_name}은 공격 지역 점유율 {home_attack_pct:.0f}%로 적극적인 공세를 펼쳤습니다.")
    if away_attack_pct > 40:
        parts.append(f"{away_name}은 공격 지역 점유율 {away_attack_pct:.0f}%로 반격 기회를 노렸습니다.")

    return " ".join(parts)


# ══════════════════════════════════════════════════
#  메인: 고급 분석 실행
# ══════════════════════════════════════════════════

def run_advanced_analysis(
    match_id: int,
    home_name: str,
    away_name: str,
    players: List[Any],           # PlayerTrackSummary 객체 목록
    frame_data: List[Dict],       # FrameTracking dict 목록
    fps: float = 30.0,
) -> Dict:
    """
    고급 분석 실행 후 MatchAnalytics에 저장할 데이터 반환.
    """
    home_frames = [d for d in frame_data if d.get("team_side") == "home"]
    away_frames = [d for d in frame_data if d.get("team_side") == "away"]

    home_pos = [(d["x"], d["y"]) for d in home_frames]
    away_pos = [(d["x"], d["y"]) for d in away_frames]

    # 포메이션 감지
    home_avg_positions = []
    for p in players:
        if p.get("team_side") == "home":
            home_avg_positions.append((p.get("avg_position_x", 0.5), p.get("avg_position_y", 0.5)))
    away_avg_positions = []
    for p in players:
        if p.get("team_side") == "away":
            away_avg_positions.append((p.get("avg_position_x", 0.5), p.get("avg_position_y", 0.5)))

    home_formation = detect_formation(home_avg_positions)
    away_formation = detect_formation(away_avg_positions)

    # 9구역 점유율
    home_zone = calc_zone_map(home_pos)
    away_zone  = calc_zone_map(away_pos)

    # 압박 강도
    press = calc_press_intensity(home_pos, away_pos)

    # 무게중심 타임라인
    home_centroid = calc_centroid_timeline(frame_data, "home", fps=fps)
    away_centroid = calc_centroid_timeline(frame_data, "away", fps=fps)

    # 피로도 타임라인 (팀 평균)
    home_fatigue = calc_fatigue_timeline(home_frames, fps=fps)
    away_fatigue  = calc_fatigue_timeline(away_frames, fps=fps)

    # 총 이동거리
    home_dist = sum(p.get("total_distance_m", 0) for p in players if p.get("team_side") == "home")
    away_dist = sum(p.get("total_distance_m", 0) for p in players if p.get("team_side") == "away")

    # 경기 총평
    summary = generate_match_summary(
        home_name, away_name,
        home_formation, away_formation,
        home_dist, away_dist,
        press["home_press_rate"], press["away_press_rate"],
        home_zone, away_zone,
    )

    return {
        "match_id": match_id,
        "home_formation": home_formation,
        "away_formation": away_formation,
        "home_zone_map": json.dumps(home_zone, ensure_ascii=False),
        "away_zone_map": json.dumps(away_zone, ensure_ascii=False),
        "home_press_timeline": json.dumps([], ensure_ascii=False),
        "away_press_timeline": json.dumps([], ensure_ascii=False),
        "home_centroid_timeline": json.dumps(home_centroid, ensure_ascii=False),
        "away_centroid_timeline": json.dumps(away_centroid, ensure_ascii=False),
        "home_fatigue_timeline": json.dumps(home_fatigue, ensure_ascii=False),
        "away_fatigue_timeline": json.dumps(away_fatigue, ensure_ascii=False),
        "home_total_distance_m": round(home_dist, 2),
        "away_total_distance_m": round(away_dist, 2),
        "home_avg_press_dist": press["home_press_rate"],
        "away_avg_press_dist": press["away_press_rate"],
        "match_summary_text": summary,
    }
