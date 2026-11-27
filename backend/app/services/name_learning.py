"""사람이 넣은 이름으로 나머지 조각의 이름을 추정한다 ('이름 배우기').

카메라가 돌 때마다 선수 추적이 끊겨 한 쿼터에 조각이 수십 개 생긴다. 사람이 이름을 넣은(확인한) 조각이 쌓이면
아직 이름 없는 조각 하나하나에 대해 다음을 본다:
- 시간: 그 조각이 보인 장면에 이미 다른 자리에서 보이는 선수는 그 사람일 수 없다(같은 장면에 함께 잡힘 = 다른 사람).
  남은 후보 중, 그 시간에 화면에서 사라져 있던 선수가 이 조각이다. 사라져 있던 틈이 조각 길이에 꼭 맞을수록 유력하다.
- 자리: 조각의 경기장 평균 위치가 그 선수가 그 무렵(앞뒤로 확인된 조각) 있던 자리와 가까울수록 유력하다.
  교체(예: 성현 → 진원랑)로 들어온 선수도 그 자리를 이어받으므로 자리와 시간으로 함께 잡힌다.
- 외형: 썸네일의 머리·반바지·양말 색이 그 선수의 확인된 조각과 비슷할수록 유력하다(같은 유니폼이라 약한 단서).
점수가 가장 좋은 이름과 두 번째 이름의 차이(여유)가 충분할 때만 추정(물음표)으로 붙인다. 사람이 '맞음'을 눌러 확인한다.
확인된 조각을 하나씩 가리고 맞혀 보는 방식(leave-one-out)으로 정확도를 함께 잰다.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

import numpy as np
from sqlalchemy.orm import Session

from app.models import Match, MatchPlayer
from app.services.result_service import _heads, _loads
from app.services.roster_service import _overlay, _thumb_appearance
from app.vision import color as C

MIN_PIECE_S = 3.0          # 이보다 짧게 보인 조각은 추정하지 않는다
CO_VISIBLE_TOL_S = 1.0     # 이만큼 넘게 같은 장면에 함께 보이면 다른 사람
NEAR_S = 90.0              # 자리 비교에 쓰는 '그 무렵' 범위


@dataclass
class Piece:
    tid: str
    frames: set
    t0: float
    t1: float
    secs: float
    pos: Optional[Tuple[float, float]]
    app: Optional[np.ndarray]


@dataclass
class Player:
    name: str
    head: str
    pieces: List[Piece] = field(default_factory=list)
    frames: set = field(default_factory=set)


def _piece(r: MatchPlayer, tracks: Dict, step: float, start: float, app_cache: Dict) -> Optional[Piece]:
    rows = tracks.get(r.track_id) or []
    if not rows:
        return None
    st = _loads(r.stats_json, {}) or {}
    ax, ay = st.get("avg_x"), st.get("avg_y")
    if r.track_id not in app_cache:
        app_cache[r.track_id] = _thumb_appearance(r.thumbnail)
    return Piece(r.track_id, {x[0] for x in rows}, start + rows[0][0] * step, start + rows[-1][0] * step,
                 len(rows) * step, (float(ax), float(ay)) if ax is not None and ay is not None else None,
                 app_cache[r.track_id])


def _model(db: Session, match: Match, team: str):
    overlay = _overlay(match)
    if overlay is None:
        raise ValueError("영상 위치 데이터가 없어 이름을 배울 수 없습니다")
    tracks, step, start = overlay.get("tracks") or {}, float(overlay["step"]), float(overlay.get("start_s") or 0)
    rows = db.query(MatchPlayer).filter(MatchPlayer.match_id == match.id).all()
    by_id = {r.track_id: r for r in rows}
    heads = _heads(rows)
    cache: Dict = {}
    players: Dict[str, Player] = {}
    unknown: List[Tuple[MatchPlayer, Piece]] = []
    for r in rows:
        h = by_id[heads[r.track_id]]
        if h.excluded or h.team != team or r.excluded:
            continue
        pc = _piece(r, tracks, step, start, cache)
        if pc is None:
            continue
        confirmed = bool(h.display_name) and (r is h or not r.auto_merged)
        if confirmed:
            pl = players.setdefault(h.display_name, Player(h.display_name, h.track_id))
            pl.pieces.append(pc)
            pl.frames |= pc.frames
        elif pc.secs >= MIN_PIECE_S:
            unknown.append((r, pc))
    return players, unknown, step


def _scores(pc: Piece, players: Dict[str, Player], step: float, skip: Optional[Piece] = None
            ) -> List[Tuple[float, str, Dict]]:
    """이름마다 점수(낮을수록 유력). 같은 장면에 함께 보인 이름은 뺀다."""
    out = []
    for name, pl in players.items():
        own = [q for q in pl.pieces if q is not skip]
        if not own:
            continue
        frames = pl.frames if skip is None or skip not in pl.pieces else set().union(*(q.frames for q in own))
        if len(pc.frames & frames) * step > CO_VISIBLE_TOL_S:
            continue
        before = [q for q in own if q.t1 <= pc.t0 + CO_VISIBLE_TOL_S]
        after = [q for q in own if q.t0 >= pc.t1 - CO_VISIBLE_TOL_S]
        gb = pc.t0 - max(q.t1 for q in before) if before else None
        ga = min(q.t0 for q in after) - pc.t1 if after else None
        # 틀: 앞뒤로 그 선수가 안 보이던 시간(조각 길이를 뺀 여유). 한쪽만 있으면 그쪽 틈만 본다
        gaps = [g for g in (gb, ga) if g is not None]
        gap = sum(max(g, 0.0) for g in gaps) / len(gaps)
        # 경기에서 빠진(교체) 선수: 앞이나 뒤로 확인된 조각이 하나도 없고 멀리 떨어져 있으면 불리
        edge = 0.0 if (before and after) else 1.0
        # 자리: 그 무렵(앞뒤 NEAR_S초) 확인된 조각들의 평균 자리
        near = [q for q in own if q.pos and (abs(q.t1 - pc.t0) < NEAR_S or abs(q.t0 - pc.t1) < NEAR_S)] or \
               [q for q in own if q.pos]
        pos_d = None
        if pc.pos and near:
            w = sum(q.secs for q in near)
            mx = sum(q.pos[0] * q.secs for q in near) / w
            my = sum(q.pos[1] * q.secs for q in near) / w
            pos_d = float(np.hypot(pc.pos[0] - mx, pc.pos[1] - my))
        apps = [C.appearance_distance(pc.app, q.app) for q in own]
        apps = [a for a in apps if a is not None]
        app_d = float(np.median(apps)) if apps else None
        score = (min(gap, 120.0) / 30.0) + 2.0 * edge + (pos_d / 0.1 if pos_d is not None else 1.5) \
            + (app_d / 15.0 if app_d is not None else 1.0)
        out.append((score, name, {"gap": gap, "pos": pos_d, "app": app_d, "edge": edge}))
    return sorted(out)


def evaluate(db: Session, match: Match, team: str, detail: bool = False) -> Dict:
    """확인된 조각을 하나씩 가리고 나머지로 맞혀 본다. 여유(margin)별 정답률."""
    players, _, step = _model(db, match, team)
    rows = []
    for name, pl in players.items():
        if len(pl.pieces) < 2:
            continue
        for q in pl.pieces:
            if q.secs < MIN_PIECE_S:
                continue
            sc = _scores(q, players, step, skip=q)
            if not sc:
                continue
            margin = sc[1][0] - sc[0][0] if len(sc) > 1 else 99.0
            rows.append({"name": name, "pred": sc[0][1], "margin": margin, "n_feasible": len(sc),
                         "ok": sc[0][1] == name, "secs": q.secs, "tid": q.tid, "t0": q.t0, "t1": q.t1,
                         "cands": [{"name": n, **f} for _, n, f in sc] if detail else None})
    out = {"tested": len(rows), "top1": sum(r["ok"] for r in rows) / max(len(rows), 1)}
    if detail:
        out["rows"] = rows
    for th in (0.5, 1.0, 1.5, 2.0, 3.0):
        sel = [r for r in rows if r["margin"] >= th]
        out[f"margin>={th}"] = {"coverage": len(sel) / max(len(rows), 1),
                                "precision": sum(r["ok"] for r in sel) / max(len(sel), 1), "n": len(sel)}
    out["only_one_feasible"] = {"n": sum(r["n_feasible"] == 1 for r in rows),
                                "precision": sum(r["ok"] for r in rows if r["n_feasible"] == 1)
                                / max(sum(r["n_feasible"] == 1 for r in rows), 1)}
    return out


def learn(db: Session, match: Match, team: str, apply: bool, min_margin: float) -> Dict:
    """이름 없는 조각에 추정 이름을 붙인다(apply면 저장). 가장 자신 있는 조각부터 하나씩 붙이고,
    붙인 조각도 그 선수의 자리로 쳐서 다음 조각과 같은 장면에 겹치지 않게 한다."""
    players, unknown, step = _model(db, match, team)
    done: List[Dict] = []
    assigned: set = set()
    left = list(unknown)
    while left:
        best = None
        for r, pc in left:
            sc = _scores(pc, players, step)
            if not sc:
                continue
            margin = sc[1][0] - sc[0][0] if len(sc) > 1 else 99.0
            if margin >= min_margin and (best is None or margin > best[0]):
                best = (margin, r, pc, sc[0][1])
        if best is None:
            break
        margin, r, pc, name = best
        left = [x for x in left if x[0] is not r]
        pl = players[name]
        pl.frames |= pc.frames
        pl.pieces.append(pc)          # 다음 조각의 시간·자리 판단에 쓴다
        done.append({"track_id": r.track_id, "name": name, "margin": round(margin, 2),
                     "from_s": round(pc.t0, 1), "to_s": round(pc.t1, 1)})
        if apply:
            head_id = pl.head
            # 이름 없는 묶음의 대표였으면 묶여 있던 조각은 원래대로 둔다(각자 따로 추정된다)
            for kid in db.query(MatchPlayer).filter(MatchPlayer.match_id == match.id,
                                                    MatchPlayer.merged_into == r.track_id).all():
                if kid.track_id not in assigned:
                    kid.merged_into, kid.auto_merged = None, False
            r.merged_into, r.auto_merged = head_id, True
            assigned.add(r.track_id)
    if apply:
        db.commit()
    return {"suggested": len(done), "unknown": len(unknown), "items": done}
