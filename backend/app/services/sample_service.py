"""
샘플 분석 서비스
================
영상 없이 즉시 실행 가능한 더미 분석 데이터를 생성합니다.
"""

import math
import random
from typing import List, Tuple, Dict, Any


def _seeded_rng(seed: int) -> random.Random:
    return random.Random(seed)


def _calc_distance(positions: List[Tuple[float, float]]) -> float:
    """정규화 좌표 시퀀스에서 총 이동거리(m) 계산 (경기장 105×68m 기준)."""
    total = 0.0
    for i in range(1, len(positions)):
        dx = (positions[i][0] - positions[i - 1][0]) * 105.0
        dy = (positions[i][1] - positions[i - 1][1]) * 68.0
        total += math.sqrt(dx * dx + dy * dy)
    return total


def _active_area_score(positions: List[Tuple[float, float]]) -> float:
    """활동 범위 점수 (이동 분산 기반, 0~100)."""
    if len(positions) < 2:
        return 0.0
    xs = [p[0] for p in positions]
    ys = [p[1] for p in positions]
    spread = (max(xs) - min(xs)) * 105 + (max(ys) - min(ys)) * 68
    return min(round(spread * 1.2, 1), 100.0)


def _generate_comment(
    total_m: float,
    avg_x: float,
    avg_y: float,
    stamina_ratio: float,
    active_score: float,
) -> str:
    """규칙 기반 AI 코멘트."""
    parts: List[str] = []

    # 이동거리
    if total_m > 10000:
        parts.append("경기 전반에 걸쳐 높은 활동량을 보였습니다.")
    elif total_m > 7000:
        parts.append("안정적인 이동거리를 기록했습니다.")
    else:
        parts.append("이동거리가 다소 적었습니다. 적극적인 움직임을 권장합니다.")

    # 위치
    if avg_x < 0.3:
        parts.append("측면 왼쪽 활동 비중이 높았습니다.")
    elif avg_x > 0.7:
        parts.append("측면 오른쪽 활동 비중이 높았습니다.")
    else:
        parts.append("중앙 구역 중심으로 활동했습니다.")

    if avg_y < 0.35:
        parts.append("공격적인 전방 위치를 유지했습니다.")
    elif avg_y > 0.65:
        parts.append("수비 지역 커버에 집중했습니다.")

    # 체력
    if stamina_ratio < 0.7:
        parts.append("후반 활동량이 크게 줄었습니다. 체력 훈련을 권장합니다.")
    elif stamina_ratio >= 0.9:
        parts.append("전후반 균등한 체력 유지력이 돋보였습니다.")

    # 활동 범위
    if active_score > 65:
        parts.append("넓은 커버 범위로 팀에 기여했습니다.")

    return " ".join(parts)


def _generate_style_badge(avg_x: float, avg_y: float, total_m: float, active_score: float) -> str:
    """활동 스타일 배지."""
    if total_m > 9500:
        return "활동량형"
    if active_score > 65:
        return "넓은커버"
    if avg_x < 0.3:
        return "좌측형"
    if avg_x > 0.7:
        return "우측형"
    if avg_y < 0.38:
        return "공격형"
    if avg_y > 0.62:
        return "수비형"
    return "중앙형"


def generate_sample_data(
    match_id: int,
    home_color: str,
    away_color: str,
    field_type: str = "soccer",
    num_home: int = 7,
    num_away: int = 7,
) -> Dict[str, Any]:
    """
    샘플 분석 데이터 생성.

    Returns:
        {
          "players": [PlayerTrackSummary dict, ...],
          "frames":  [FrameTracking dict, ...],
        }
    """
    players: List[Dict] = []
    all_frames: List[Dict] = []

    total_players = num_home + num_away
    TOTAL_FRAMES = 540          # 90분 × 6fps 샘플
    HALF_FRAME   = TOTAL_FRAMES // 2

    for i in range(total_players):
        is_home   = i < num_home
        team_side = "home" if is_home else "away"
        track_id  = f"track_{i + 1}"
        rng       = _seeded_rng(match_id * 100 + i)

        # 선수 기본 포지션
        home_x = rng.uniform(0.1, 0.9)
        home_y = rng.uniform(0.15, 0.85)
        mobility = rng.uniform(0.04, 0.16)

        positions: List[Tuple[float, float]] = []
        x, y = home_x, home_y

        frames_for_player: List[Dict] = []
        for fi in range(TOTAL_FRAMES):
            ts_ms = fi * (90000 * 60 // TOTAL_FRAMES)   # 90분 × 60초 × 1000ms
            fatigue = 1.0 if fi < HALF_FRAME else rng.uniform(0.6, 1.0)
            step    = mobility * fatigue * 0.1
            x = max(0.05, min(0.95, x + rng.gauss(0, step)))
            y = max(0.05, min(0.95, y + rng.gauss(0, step * 0.7)))
            positions.append((x, y))
            frames_for_player.append({
                "match_id":    match_id,
                "frame_index": fi,
                "timestamp_ms": ts_ms,
                "track_id":    track_id,
                "team_side":   team_side,
                "x":           round(x, 4),
                "y":           round(y, 4),
                "bbox_x":      round(x * 1280, 1),
                "bbox_y":      round(y * 720, 1),
                "bbox_w":      60.0,
                "bbox_h":      120.0,
            })

        all_frames.extend(frames_for_player)

        # 통계 계산
        first_half  = positions[:HALF_FRAME]
        second_half = positions[HALF_FRAME:]
        dist_total  = _calc_distance(positions)
        dist_first  = _calc_distance(first_half)
        dist_second = _calc_distance(second_half)
        avg_x       = sum(p[0] for p in positions) / len(positions)
        avg_y       = sum(p[1] for p in positions) / len(positions)
        active      = _active_area_score(positions)
        stamina     = dist_second / dist_first if dist_first > 0 else 1.0

        comment = _generate_comment(dist_total, avg_x, avg_y, stamina, active)
        badge   = _generate_style_badge(avg_x, avg_y, dist_total, active)

        players.append({
            "match_id":               match_id,
            "track_id":               track_id,
            "team_side":              team_side,
            "total_distance_m":       round(dist_total, 2),
            "avg_position_x":         round(avg_x, 4),
            "avg_position_y":         round(avg_y, 4),
            "active_area_score":      round(active, 1),
            "first_half_distance_m":  round(dist_first, 2),
            "second_half_distance_m": round(dist_second, 2),
            "comment":                comment,
            "style_badge":            badge,
        })

    return {"players": players, "frames": all_frames}
