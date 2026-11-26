"""저장된 경기의 선수 조각을 팀당 정원(필드 10 + GK 1)에 맞춰 자동으로 합친다 (되돌릴 수 있음).

분석 결과에는 경기장 좌표 궤적이 남지 않아, 영상 검수용 오버레이(장면별 화면 박스)·썸네일·선수 기록에서
조각 정보를 다시 만든다:
- 시간: 오버레이에 처음·마지막으로 나온 장면
- 위치: 첫·마지막 박스의 발 위치(화면 픽셀). 카메라가 돌면 화면 좌표가 의미 없어 3초 넘는 공백에는 쓰지 않는다
- 옆 위치(왼쪽·오른쪽 자리): 기록의 평균 위치
- 외형: 썸네일의 머리·반바지·양말 색
합치기는 merged_into로 저장하고 auto_merged로 표시해 '자동 정리 되돌리기'로 한 번에 풀 수 있다.
"""

from __future__ import annotations

import base64
import gzip
import json
from typing import Dict, List, Optional

import numpy as np
from sqlalchemy.orm import Session

from app.models import Match, MatchPlayer
from app.services.result_service import _heads, _loads
from app.vision import color as C
from app.vision.tracker import RosterPiece, assign_roster_slots

BODY_H_M = 1.75            # 박스 높이 ≈ 키
SCREEN_POS_MAX_GAP_S = 3.0


def _overlay(match: Match) -> Optional[Dict]:
    if not match.overlay_gz:
        return None
    return json.loads(gzip.decompress(base64.b64decode(match.overlay_gz)))


def _thumb_appearance(b64: Optional[str]) -> Optional[np.ndarray]:
    if not b64:
        return None
    import cv2
    img = cv2.imdecode(np.frombuffer(base64.b64decode(b64), np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        return None
    h, w = img.shape[:2]
    pad = h / 12.0       # 썸네일은 박스 위아래·양옆에 키의 10%씩 여백 (pipeline._encode_thumb)
    return C.body_appearance(cv2.cvtColor(img, cv2.COLOR_BGR2RGB), (pad, pad, w - pad, h - pad))


def _kit_refs(match: Match) -> Dict[str, np.ndarray]:
    meta = _loads(match.result_meta_json, {}) or {}
    snapped = meta.get("snapped_colors") or {}
    refs = {}
    for key, hexv in (("home", snapped.get("home") or match.home_team_color),
                      ("away", snapped.get("away") or match.away_team_color),
                      ("referee", snapped.get("referee") or match.referee_color)):
        if hexv:
            refs[key] = C.rgb_to_lab(np.array([C.hex_to_rgb(hexv)], dtype=float))[0]
    return refs


def _thumb_torso_lab(b64: Optional[str]) -> Optional[np.ndarray]:
    """썸네일 몸통(키의 25~55%, 가운데 40%) 색 중앙값 LAB. 잔디로 보이는 픽셀은 뺀다(흐린 썸네일은 잔디가 섞인다)."""
    if not b64:
        return None
    import cv2
    img = cv2.imdecode(np.frombuffer(base64.b64decode(b64), np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        return None
    h, w = img.shape[:2]
    pad = h / 12.0
    bh = h - 2 * pad
    y0, y1 = int(pad + 0.25 * bh), int(pad + 0.55 * bh)
    x0, x1 = int(w * 0.3), int(w * 0.7)
    px = cv2.cvtColor(img[y0:y1, x0:x1], cv2.COLOR_BGR2RGB).reshape(-1, 3)
    px = px[~C.grass_mask_rgb(px)] if len(px) else px
    if len(px) < 5:
        return None
    return np.median(C.rgb_to_lab(px.astype(float)), axis=0)


def build_pieces(rows: List[MatchPlayer], overlay: Dict, refs: Optional[Dict[str, np.ndarray]] = None
                 ) -> List[RosterPiece]:
    heads = _heads(rows)
    step, tracks = float(overlay["step"]), overlay["tracks"]
    groups: Dict[str, List[MatchPlayer]] = {}
    for r in rows:
        groups.setdefault(heads[r.track_id], []).append(r)
    by_id = {r.track_id: r for r in rows}
    pieces = []
    for head, mem in groups.items():
        lead = by_id[head]
        if lead.excluded or lead.display_name:
            continue   # 제외했거나 사람이 이름을 붙인 선수는 건드리지 않는다
        boxes = sorted((b for r in mem for b in tracks.get(r.track_id, [])), key=lambda b: b[0])
        if len(boxes) < 2:
            continue
        hts = [b[4] - b[2] for b in boxes]
        scale = BODY_H_M / max(float(np.median(hts)), 1.0)
        secs = [(_loads(r.stats_json, {}).get("seconds_tracked") or 0, r) for r in mem]
        w = sum(s for s, _ in secs) or 1.0
        lateral = sum(s * (_loads(r.stats_json, {}).get("avg_y") or 0) for s, r in secs) / w
        best = max(secs, key=lambda x: x[0])[1]
        if refs and C.kit_mismatch(_thumb_torso_lab(best.thumbnail), lead.team, refs):
            continue   # 심판·상대 선수가 이 팀으로 잘못 잡힌 조각은 칸에 넣지 않는다
        first, last = boxes[0], boxes[-1]
        pieces.append(RosterPiece(
            head, lead.team, (lead.label or "").endswith("_gk"), first[0] * step, last[0] * step,
            ((first[1] + first[3]) / 2, first[4]), ((last[1] + last[3]) / 2, last[4]),
            _thumb_appearance(best.thumbnail), float(lateral), scale, SCREEN_POS_MAX_GAP_S))
    return pieces


def auto_roster(db: Session, match: Match) -> Dict:
    overlay = _overlay(match)
    if overlay is None:
        raise ValueError("영상 검수 데이터가 없어 자동 정리를 할 수 없습니다")
    rows = db.query(MatchPlayer).filter(MatchPlayer.match_id == match.id).all()
    slots, extra = assign_roster_slots(build_pieces(rows, overlay, _kit_refs(match)), C.appearance_distance)
    by_id = {r.track_id: r for r in rows}
    merged = 0
    for head, lead in slots.items():
        if head != lead:
            r = by_id[head]
            r.merged_into, r.auto_merged = lead, True
            merged += 1
    db.flush()
    # 이름 붙은 골키퍼에게 남은 골키퍼 조각을 붙인다 (칸 배정은 이름 붙은 선수를 건드리지 않아 따로 한다)
    for r in rows:
        if r.display_name and not r.merged_into and not r.excluded:
            merged += attach_gk_guesses(db, match, r, overlay)
            db.flush()
    db.commit()
    teams: Dict[str, int] = {}
    for lead in set(slots.values()):
        teams[by_id[lead].team] = teams.get(by_id[lead].team, 0) + 1
    return {"merged": merged, "players": teams, "over_capacity": len(extra)}


GK_SAME_GOAL_X = 0.15      # 같은 골문 쪽: 경기장 길이 방향 평균 위치(0~1) 차이
GK_OVERLAP_FRAMES = 15     # 이만큼(약 1초) 넘게 같은 장면에 함께 보이면 다른 사람


def attach_gk_guesses(db: Session, match: Match, head: MatchPlayer, overlay: Optional[Dict] = None) -> int:
    """골키퍼는 팀에 한 명이다. 이름이 붙은 골키퍼가 있으면, 같은 팀·같은 골문 쪽에서 잡힌 이름 없는 골키퍼 조각 중
    그 선수와 같은 장면에 함께 보인 적이 없는 것을 그 선수의 추정 조각(물음표)으로 붙인다.
    카메라가 돌 때마다 골키퍼가 새 조각으로 끊겨 이름 없는 '?' 상자가 계속 남던 문제(3경기 2쿼터: 8조각 약 3분).
    반환: 붙인 조각 수."""
    if not head.display_name or head.excluded or head.merged_into:
        return 0
    rows = db.query(MatchPlayer).filter(MatchPlayer.match_id == match.id).all()
    heads = _heads(rows)
    groups: Dict[str, List[MatchPlayer]] = {}
    for r in rows:
        groups.setdefault(heads[r.track_id], []).append(r)
    mine = groups.get(head.track_id, [head])
    if not any((r.label or "").endswith("_gk") for r in _confirmed(sorted(mine, key=lambda r: r is not head))):
        return 0
    overlay = overlay if overlay is not None else _overlay(match)
    if overlay is None:
        return 0
    tracks = overlay.get("tracks") or {}

    def frames(rs: List[MatchPlayer]) -> set:
        return {b[0] for r in rs for b in tracks.get(r.track_id, [])}

    def avg_x(r: MatchPlayer) -> Optional[float]:
        v = (_loads(r.stats_json, {}) or {}).get("avg_x")
        return float(v) if v is not None else None

    gx = avg_x(head)
    taken = frames(mine)
    cands = [r for r in rows if r.track_id != head.track_id and not r.merged_into and not r.excluded
             and not r.display_name and r.team == head.team and (r.label or "").endswith("_gk")]
    cands.sort(key=lambda r: -float((_loads(r.stats_json, {}) or {}).get("seconds_tracked") or 0))
    n = 0
    for c in cands:
        cx = avg_x(c)
        if gx is not None and cx is not None and abs(cx - gx) > GK_SAME_GOAL_X:
            continue   # 반대편 골문 쪽 — 상대 골키퍼가 우리 팀으로 잘못 잡혔을 수 있다
        mem = groups.get(c.track_id, [c])
        fr = frames(mem)
        if not fr or len(fr & taken) > GK_OVERLAP_FRAMES:
            continue
        for r in mem:
            r.merged_into, r.auto_merged = head.track_id, True
        taken |= fr
        n += len(mem)
    return n


def undo_auto_roster(db: Session, match: Match) -> int:
    rows = db.query(MatchPlayer).filter(MatchPlayer.match_id == match.id, MatchPlayer.auto_merged.is_(True)).all()
    for r in rows:
        r.merged_into, r.auto_merged = None, False
    db.commit()
    return len(rows)


# ── 이름으로 합칠 때 같은 시간에 두 곳에 있는지 확인 ─────────────────────────────

OVERLAP_TOL_S = 1.0


def _span(r: MatchPlayer):
    st = _loads(r.stats_json, {}) or {}
    a, b = st.get("first_seen_s"), st.get("last_seen_s")
    return (float(a), float(b)) if a is not None and b is not None else None


def _overlap_s(a, b) -> float:
    if a is None or b is None:
        return 0.0
    return min(a[1], b[1]) - max(a[0], b[0])


def _confirmed(rows: List[MatchPlayer]) -> List[MatchPlayer]:
    """대표 조각과 사람이 합친 조각. 자동 정리(auto_merged)가 짐작으로 붙인 조각은 뺀다."""
    return [r for i, r in enumerate(rows) if i == 0 or not r.auto_merged]


def name_conflict(groups: Dict[str, List[MatchPlayer]], tol_s: float = OVERLAP_TOL_S) -> Optional[str]:
    """같은 이름으로 합치려는 선수들(대표 → [대표, 합쳐진 조각...]) 중 확인된 조각끼리 시간이 겹치면 그 시각(m:ss).
    같은 사람은 같은 시간에 두 곳에 있을 수 없다 — 다른 사람에게 같은 이름을 넣은 것이다."""
    heads = list(groups)
    for i, a in enumerate(heads):
        for b in heads[i + 1:]:
            for ra in _confirmed(groups[a]):
                for rb in _confirmed(groups[b]):
                    sa, sb = _span(ra), _span(rb)
                    if _overlap_s(sa, sb) > tol_s:
                        t = max(sa[0], sb[0])
                        return f"{int(t // 60)}:{int(t % 60):02d}"
    return None


def drop_conflicting_guesses(groups: Dict[str, List[MatchPlayer]], tol_s: float = OVERLAP_TOL_S) -> List[MatchPlayer]:
    """짐작으로 붙은 조각 중, 같은 이름의 다른 선수의 확인된 조각과 시간이 겹치는 것 — 그 시간에 그 선수는 다른 곳에 있었다."""
    out = []
    for h, rows in groups.items():
        others = [r for g, rs in groups.items() if g != h for r in _confirmed(rs)]
        for r in rows[1:]:
            if r.auto_merged and any(_overlap_s(_span(r), _span(o)) > tol_s for o in others):
                out.append(r)
    return out
