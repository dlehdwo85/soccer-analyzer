"""
샘플 데이터 생성 서비스 (확장판)
==================================
유튜브 영상 + 원본 영상 분석 기준으로
더 현실적인 샘플 데이터 생성
"""

import math
import random
import json
from typing import List, Tuple, Dict, Any

from app.services.advanced_analysis_service import (
    classify_role, count_sprints, calc_zone_map,
    calc_fatigue_timeline, SPRINT_SPEED_MPS
)


def _rng(seed: int) -> random.Random:
    return random.Random(seed)


def _calc_distance(positions: List[Tuple[float, float]]) -> float:
    total = 0.0
    for i in range(1, len(positions)):
        dx = (positions[i][0] - positions[i-1][0]) * 105.0
        dy = (positions[i][1] - positions[i-1][1]) * 68.0
        total += math.sqrt(dx*dx + dy*dy)
    return total


def _active_area_score(positions: List[Tuple[float, float]]) -> float:
    if len(positions) < 2:
        return 0.0
    xs = [p[0] for p in positions]
    ys = [p[1] for p in positions]
    spread = (max(xs)-min(xs))*105 + (max(ys)-min(ys))*68
    return min(round(spread * 1.2, 1), 100.0)


def _generate_comment(total_m, avg_x, avg_y, stamina_ratio, active_score) -> str:
    parts = []
    if total_m > 10000:
        parts.append("경기 전반에 걸쳐 높은 활동량을 보였습니다.")
    elif total_m > 7000:
        parts.append("안정적인 이동거리를 기록했습니다.")
    else:
        parts.append("이동거리가 다소 적었습니다. 적극적인 움직임을 권장합니다.")

    if avg_x < 0.30:
        parts.append("측면 왼쪽 활동 비중이 높았습니다.")
    elif avg_x > 0.70:
        parts.append("측면 오른쪽 활동 비중이 높았습니다.")
    else:
        parts.append("중앙 구역 중심으로 활동했습니다.")

    if avg_y < 0.35:
        parts.append("공격적인 전방 위치를 유지했습니다.")
    elif avg_y > 0.65:
        parts.append("수비 지역 커버에 집중했습니다.")

    if stamina_ratio < 0.7:
        parts.append("후반 활동량이 크게 줄었습니다. 체력 훈련을 권장합니다.")
    elif stamina_ratio >= 0.9:
        parts.append("전후반 균등한 체력 유지력이 돋보였습니다.")

    if active_score > 65:
        parts.append("넓은 커버 범위로 팀에 기여했습니다.")

    return " ".join(parts)


def _generate_style_badge(avg_x, avg_y, total_m, active_score) -> str:
    if total_m > 9500:
        return "활동량형"
    if active_score > 65:
        return "넓은커버"
    if avg_x < 0.30:
        return "좌측윙어"
    if avg_x > 0.70:
        return "우측윙어"
    if avg_y < 0.38:
        return "공격형"
    if avg_y > 0.62:
        return "수비형"
    return "플메이커"


def generate_sample_data(
    match_id: int,
    home_color: str,
    away_color: str,
    field_type: str = "soccer",
    num_home: int = 7,
    num_away: int = 7,
) -> Dict[str, Any]:
    """샘플 분석 데이터 생성 (고급 지표 포함)"""

    players_out = []
    all_frames = []

    total_players = num_home + num_away
    TOTAL_FRAMES = 540
    HALF_FRAME = TOTAL_FRAMES // 2
    FPS = 30.0

    # 포지션 프리셋 (더 현실적인 배치)
    position_presets = {
        "home": [
            (0.5, 0.85),   # GK
            (0.2, 0.65), (0.4, 0.65), (0.6, 0.65), (0.8, 0.65),  # DF
            (0.25, 0.45), (0.5, 0.45), (0.75, 0.45),              # MF
            (0.3, 0.25), (0.5, 0.20), (0.7, 0.25),               # FW
        ],
        "away": [
            (0.5, 0.15),   # GK
            (0.2, 0.35), (0.4, 0.35), (0.6, 0.35), (0.8, 0.35),  # DF
            (0.25, 0.55), (0.5, 0.55), (0.75, 0.55),              # MF
            (0.3, 0.75), (0.5, 0.80), (0.7, 0.75),               # FW
        ]
    }

    for i in range(total_players):
        is_home = i < num_home
        team_side = "home" if is_home else "away"
        player_idx = i if is_home else i - num_home
        track_id = f"track_{i+1}"
        rng = _rng(match_id * 100 + i)

        # 포지션 설정
        presets = position_presets[team_side]
        if player_idx < len(presets):
            home_x, home_y = presets[player_idx]
            home_x += rng.uniform(-0.05, 0.05)
            home_y += rng.uniform(-0.05, 0.05)
        else:
            home_x = rng.uniform(0.1, 0.9)
            home_y = rng.uniform(0.15, 0.85)

        mobility = rng.uniform(0.04, 0.16)
        np_rng = random.Random(match_id * 200 + i)

        positions = []
        frame_dicts = []
        x, y = home_x, home_y

        for fi in range(TOTAL_FRAMES):
            ts_ms = fi * (90000 * 60 // TOTAL_FRAMES)
            fatigue = 1.0 if fi < HALF_FRAME else rng.uniform(0.55, 1.0)
            step = mobility * fatigue * 0.1
            x = max(0.05, min(0.95, x + rng.gauss(0, step)))
            y = max(0.05, min(0.95, y + rng.gauss(0, step * 0.7)))
            positions.append((x, y))
            frame_dicts.append({
                "match_id": match_id,
                "frame_index": fi,
                "timestamp_ms": ts_ms,
                "track_id": track_id,
                "team_side": team_side,
                "x": round(x, 4),
                "y": round(y, 4),
                "bbox_x": round(x * 1280, 1),
                "bbox_y": round(y * 720, 1),
                "bbox_w": 60.0, "bbox_h": 120.0,
            })

        all_frames.extend(frame_dicts)

        # 집계
        first_half = positions[:HALF_FRAME]
        second_half = positions[HALF_FRAME:]
        dist_total = _calc_distance(positions)
        dist_first = _calc_distance(first_half)
        dist_second = _calc_distance(second_half)
        avg_x = sum(p[0] for p in positions) / len(positions)
        avg_y = sum(p[1] for p in positions) / len(positions)
        active = _active_area_score(positions)
        stamina = dist_second / dist_first if dist_first > 0 else 1.0

        # 구역 점유율
        zone_map = calc_zone_map(positions)
        zone_keys = list(zone_map.keys())
        left_pct = sum(zone_map[k] for k in zone_keys if "좌측" in k)
        center_pct = sum(zone_map[k] for k in zone_keys if "중앙" in k)
        right_pct = sum(zone_map[k] for k in zone_keys if "우측" in k)

        # 스프린트
        sprints = count_sprints(frame_dicts, fps=FPS)

        # 피로도
        fatigue_idx = max(0, round((1 - stamina) * 100, 1))

        # 역할 분류
        role_type, badge = classify_role(avg_x, avg_y, active, dist_total, zone_map)

        comment = _generate_comment(dist_total, avg_x, avg_y, stamina, active)

        players_out.append({
            "match_id": match_id,
            "track_id": track_id,
            "team_side": team_side,
            "total_distance_m": round(dist_total, 2),
            "avg_position_x": round(avg_x, 4),
            "avg_position_y": round(avg_y, 4),
            "active_area_score": round(active, 1),
            "first_half_distance_m": round(dist_first, 2),
            "second_half_distance_m": round(dist_second, 2),
            "comment": comment,
            "style_badge": badge,
            "fatigue_index": fatigue_idx,
            "press_count": rng.randint(5, 30),
            "zone_left_pct": round(left_pct, 1),
            "zone_center_pct": round(center_pct, 1),
            "zone_right_pct": round(right_pct, 1),
            "role_type": role_type,
            "sprint_count": sprints,
        })

    return {"players": players_out, "frames": all_frames}
