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
    """썸네일 몸통(키의 25~55%, 가운데 40%) 색 중앙값 LAB. 형광 조끼가 잔디로 걸러지지 않게 잔디 제거는 하지 않는다
    (몸통 한가운데는 거의 상의다)."""
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
    db.commit()
    teams: Dict[str, int] = {}
    for lead in set(slots.values()):
        teams[by_id[lead].team] = teams.get(by_id[lead].team, 0) + 1
    return {"merged": merged, "players": teams, "over_capacity": len(extra)}


def undo_auto_roster(db: Session, match: Match) -> int:
    rows = db.query(MatchPlayer).filter(MatchPlayer.match_id == match.id, MatchPlayer.auto_merged.is_(True)).all()
    for r in rows:
        r.merged_into, r.auto_merged = None, False
    db.commit()
    return len(rows)
