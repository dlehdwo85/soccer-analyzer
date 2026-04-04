"""
샘플 데이터 생성 서비스 v2
============================
실제 축구 전술 기반 현실적 데이터 생성
- 포지션별 실제 이동 패턴
- 전술적 움직임 (압박, 오버래핑, 커버링)
- 피로도 현실적 반영
"""

import math
import random
from typing import List, Tuple, Dict, Any


def _rng(seed: int) -> random.Random:
    return random.Random(seed)


# ══════════════════════════════════════════════════════════════
#  포지션별 프리셋 (x=좌우 0-1, y=상하 0-1)
#  홈팀: 왼→오른 공격 / 어웨이: 오른→왼 공격
# ══════════════════════════════════════════════════════════════

HOME_PRESETS = [
    {"pos": (0.06, 0.50), "role": "골키퍼",    "badge": "GK", "mob": 0.015, "zone": (0.0, 0.15)},
    {"pos": (0.22, 0.18), "role": "좌측수비",   "badge": "LB", "mob": 0.09,  "zone": (0.1, 0.5)},
    {"pos": (0.20, 0.40), "role": "중앙수비",   "badge": "CB", "mob": 0.06,  "zone": (0.1, 0.45)},
    {"pos": (0.20, 0.60), "role": "중앙수비",   "badge": "CB", "mob": 0.06,  "zone": (0.1, 0.45)},
    {"pos": (0.22, 0.82), "role": "우측수비",   "badge": "RB", "mob": 0.09,  "zone": (0.1, 0.5)},
    {"pos": (0.42, 0.30), "role": "좌중앙미드", "badge": "CM", "mob": 0.12,  "zone": (0.3, 0.7)},
    {"pos": (0.40, 0.50), "role": "수비형미드", "badge": "DM", "mob": 0.10,  "zone": (0.25, 0.65)},
    {"pos": (0.42, 0.70), "role": "우중앙미드", "badge": "CM", "mob": 0.12,  "zone": (0.3, 0.7)},
    {"pos": (0.68, 0.12), "role": "좌측윙어",   "badge": "LW", "mob": 0.15,  "zone": (0.45, 0.95)},
    {"pos": (0.72, 0.50), "role": "스트라이커", "badge": "ST", "mob": 0.14,  "zone": (0.5, 1.0)},
    {"pos": (0.68, 0.88), "role": "우측윙어",   "badge": "RW", "mob": 0.15,  "zone": (0.45, 0.95)},
]

AWAY_PRESETS = [
    {"pos": (0.94, 0.50), "role": "골키퍼",    "badge": "GK", "mob": 0.015, "zone": (0.85, 1.0)},
    {"pos": (0.78, 0.82), "role": "좌측수비",   "badge": "LB", "mob": 0.09,  "zone": (0.5, 0.9)},
    {"pos": (0.80, 0.60), "role": "중앙수비",   "badge": "CB", "mob": 0.06,  "zone": (0.55, 0.9)},
    {"pos": (0.80, 0.40), "role": "중앙수비",   "badge": "CB", "mob": 0.06,  "zone": (0.55, 0.9)},
    {"pos": (0.78, 0.18), "role": "우측수비",   "badge": "RB", "mob": 0.09,  "zone": (0.5, 0.9)},
    {"pos": (0.60, 0.20), "role": "우측미드",   "badge": "RM", "mob": 0.11,  "zone": (0.3, 0.7)},
    {"pos": (0.58, 0.42), "role": "중앙미드",   "badge": "CM", "mob": 0.10,  "zone": (0.3, 0.7)},
    {"pos": (0.58, 0.58), "role": "중앙미드",   "badge": "CM", "mob": 0.10,  "zone": (0.3, 0.7)},
    {"pos": (0.60, 0.80), "role": "좌측미드",   "badge": "LM", "mob": 0.11,  "zone": (0.3, 0.7)},
    {"pos": (0.36, 0.38), "role": "스트라이커", "badge": "ST", "mob": 0.13,  "zone": (0.0, 0.5)},
    {"pos": (0.36, 0.62), "role": "스트라이커", "badge": "ST", "mob": 0.13,  "zone": (0.0, 0.5)},
]


def _calc_distance(positions: List[Tuple[float, float]]) -> float:
    total = 0.0
    for i in range(1, len(positions)):
        dx = (positions[i][0] - positions[i-1][0]) * 105.0
        dy = (positions[i][1] - positions[i-1][1]) * 68.0
        total += math.sqrt(dx*dx + dy*dy)
    return total


def _gen_comment(total_m, avg_x, avg_y, stamina, active, badge, role, sprint):
    parts = []

    # 활동량
    if total_m > 11000:
        parts.append(f"경기 전반에 걸쳐 탁월한 활동량({total_m/1000:.1f}km)을 보여줬습니다.")
    elif total_m > 9000:
        parts.append(f"평균 이상의 이동거리({total_m/1000:.1f}km)로 팀에 기여했습니다.")
    elif total_m > 7000:
        parts.append(f"안정적인 이동거리({total_m/1000:.1f}km)를 기록했습니다.")
    else:
        parts.append(f"이동거리({total_m/1000:.1f}km)가 다소 부족했습니다. 적극적 움직임이 필요합니다.")

    # 포지션 특성
    if badge == 'GK':
        parts.append("골문 앞 수비 집중 포지션으로 최소 이동이 정상입니다.")
    elif badge in ('LW', 'RW'):
        if avg_x > 0.55:
            parts.append("측면 깊숙이 침투하며 공격 폭을 넓혔습니다.")
        else:
            parts.append("중앙으로 자주 들어오는 인버티드 성향을 보였습니다.")
    elif badge == 'ST':
        if avg_y < 0.35 or avg_y > 0.65:
            parts.append("측면 공간까지 움직이며 수비 라인을 흔들었습니다.")
        else:
            parts.append("중앙 페널티 구역을 집중 공략했습니다.")
    elif badge in ('CB',):
        parts.append("수비 라인 안정화에 집중하며 불필요한 이탈을 최소화했습니다.")
    elif badge in ('LB', 'RB'):
        if active > 60:
            parts.append("공격적인 오버래핑으로 측면을 장악했습니다.")
        else:
            parts.append("수비적 포지션을 유지하며 측면 안정성을 담당했습니다.")
    elif badge in ('DM',):
        parts.append("중원에서 수비와 빌드업을 연결하는 핵심 역할을 수행했습니다.")

    # 스프린트
    if sprint > 15:
        parts.append(f"스프린트 {sprint}회로 강도 높은 경기력을 보였습니다.")
    elif sprint > 8:
        parts.append(f"적절한 스프린트({sprint}회)로 필요 시 빠른 이동을 보여줬습니다.")

    # 체력
    if stamina < 0.70:
        parts.append("후반 활동량이 크게 감소했습니다. 체력 강화 훈련을 권장합니다.")
    elif stamina >= 0.92:
        parts.append("전후반 동등한 체력 유지력이 인상적이었습니다.")

    return " ".join(parts)


def _gen_badge(avg_x, avg_y, total_m, active, badge_preset):
    """포지션 프리셋 배지 우선, 없으면 계산"""
    if badge_preset:
        return badge_preset
    if total_m > 10500: return "활동량형"
    if active > 70: return "넓은커버"
    if avg_x < 0.28: return "좌측윙어"
    if avg_x > 0.72: return "우측윙어"
    if avg_y < 0.35: return "공격형"
    if avg_y > 0.65: return "수비형"
    return "플메이커"


def generate_sample_data(
    match_id: int,
    home_color: str,
    away_color: str,
    field_type: str = "soccer",
    num_home: int = 11,
    num_away: int = 11,
) -> Dict[str, Any]:

    players_out = []
    all_frames = []

    TOTAL_FRAMES = 1620   # 90분 × 18fps 샘플
    HALF_FRAME = TOTAL_FRAMES // 2
    FPS = 18.0

    home_presets = HOME_PRESETS[:num_home]
    away_presets = AWAY_PRESETS[:num_away]

    all_presets = [(p, "home") for p in home_presets] + [(p, "away") for p in away_presets]

    for idx, (preset, team_side) in enumerate(all_presets):
        track_id = f"track_{idx+1}"
        rng = _rng(match_id * 200 + idx)

        base_x, base_y = preset["pos"]
        zone_min, zone_max = preset["zone"]
        mob = preset["mob"]

        positions = []
        frame_dicts = []
        x, y = base_x + rng.gauss(0, 0.02), base_y + rng.gauss(0, 0.02)

        # 경기 단계별 패턴
        for fi in range(TOTAL_FRAMES):
            ts_ms = int(fi / FPS * 1000)
            progress = fi / TOTAL_FRAMES  # 0~1

            # 피로도: 후반 갈수록 활동 감소
            if fi < HALF_FRAME:
                fatigue_factor = 1.0 - progress * 0.1
            else:
                second_progress = (fi - HALF_FRAME) / HALF_FRAME
                fatigue_factor = 0.95 - second_progress * rng.uniform(0.15, 0.35)
            fatigue_factor = max(0.5, fatigue_factor)

            # 포지션 복귀 경향 (elastic)
            elastic = 0.03
            x += (base_x - x) * elastic
            y += (base_y - y) * elastic

            # 랜덤 이동
            step = mob * fatigue_factor
            x += rng.gauss(0, step)
            y += rng.gauss(0, step * 0.8)

            # 경기장 영역 제한
            x = max(0.03, min(0.97, x))
            y = max(0.03, min(0.97, y))

            # 포지션 구역 제한 (GK 강화)
            if preset["badge"] == "GK":
                x_limit = (0.02, 0.12) if team_side == "home" else (0.88, 0.98)
                x = max(x_limit[0], min(x_limit[1], x))
                y = max(0.25, min(0.75, y))

            positions.append((x, y))
            frame_dicts.append({
                "match_id": match_id, "frame_index": fi,
                "timestamp_ms": ts_ms, "track_id": track_id,
                "team_side": team_side,
                "x": round(x, 4), "y": round(y, 4),
                "bbox_x": round(x*1920,1), "bbox_y": round(y*1080,1),
                "bbox_w": 55.0, "bbox_h": 110.0,
            })

        all_frames.extend(frame_dicts)

        # ── 통계 계산 ─────────────────────────────────────
        first_half = positions[:HALF_FRAME]
        second_half = positions[HALF_FRAME:]
        dist_total = _calc_distance(positions)
        dist_first = _calc_distance(first_half)
        dist_second = _calc_distance(second_half)
        avg_x = sum(p[0] for p in positions) / len(positions)
        avg_y = sum(p[1] for p in positions) / len(positions)

        xs = [p[0] for p in positions]
        ys = [p[1] for p in positions]
        spread = (max(xs)-min(xs))*105 + (max(ys)-min(ys))*68
        active = min(round(spread * 1.1, 1), 100.0)

        stamina = dist_second / dist_first if dist_first > 0 else 1.0
        fatigue_idx = max(0, round((1 - stamina) * 100, 1))

        # 구역 점유
        left_cnt = sum(1 for p in positions if p[0] < 0.33)
        ctr_cnt = sum(1 for p in positions if 0.33 <= p[0] < 0.67)
        right_cnt = sum(1 for p in positions if p[0] >= 0.67)
        total_cnt = len(positions) or 1
        zone_left = round(left_cnt/total_cnt*100, 1)
        zone_ctr = round(ctr_cnt/total_cnt*100, 1)
        zone_right = round(right_cnt/total_cnt*100, 1)

        # 스프린트 감지
        sprint_count = 0
        in_sprint = False
        for i in range(1, len(positions)):
            dx = (positions[i][0]-positions[i-1][0])*105
            dy = (positions[i][1]-positions[i-1][1])*68
            speed = math.sqrt(dx*dx+dy*dy) * FPS
            if speed > 6.0:
                if not in_sprint:
                    sprint_count += 1
                    in_sprint = True
            else:
                in_sprint = False

        # 압박 횟수
        press_count = rng.randint(5, 35) if preset["badge"] not in ('GK',) else rng.randint(0, 3)

        badge = _gen_badge(avg_x, avg_y, dist_total, active, preset["badge"])
        comment = _gen_comment(dist_total, avg_x, avg_y, stamina, active, preset["badge"], preset["role"], sprint_count)

        players_out.append({
            "match_id": match_id, "track_id": track_id, "team_side": team_side,
            "total_distance_m": round(dist_total, 2),
            "avg_position_x": round(avg_x, 4), "avg_position_y": round(avg_y, 4),
            "active_area_score": round(active, 1),
            "first_half_distance_m": round(dist_first, 2),
            "second_half_distance_m": round(dist_second, 2),
            "comment": comment, "style_badge": badge,
            "fatigue_index": fatigue_idx,
            "press_count": press_count,
            "zone_left_pct": zone_left, "zone_center_pct": zone_ctr, "zone_right_pct": zone_right,
            "role_type": preset["role"], "sprint_count": sprint_count,
        })

    return {"players": players_out, "frames": all_frames}


# 호환성 유지용
def _generate_comment(total_m, avg_x, avg_y, stamina, active):
    return _gen_comment(total_m, avg_x, avg_y, stamina, active, '', '', 0)

def _generate_style_badge(avg_x, avg_y, total_m, active):
    return _gen_badge(avg_x, avg_y, total_m, active, '')
