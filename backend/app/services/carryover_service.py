"""다시 분석해도 사람이 해 둔 작업(이름·등번호·역할·제외·합치기·이벤트 검수)을 새 결과로 옮긴다.

다시 분석하면 트랙 번호가 전부 바뀌어 번호로는 이을 수 없다. 대신 영상 검수 오버레이(장면별 화면 박스)로
'같은 영상 시각에 같은 자리에 있던 트랙'을 찾아 옛 선수와 새 트랙을 잇는다:
- 새 트랙마다 박스를 고르게 최대 MAX_SAMPLES개 뽑고, 그 시각의 옛 박스(앞뒤 장면 사이는 이어서 계산)와
  IoU가 IOU_MIN 이상이면 가장 많이 겹친 옛 트랙에 한 표. 표는 옛 선수(merged_into를 따라간 대표) 기준으로 모은다.
- 표를 가장 많이 받은 옛 선수가 MIN_VOTES표 이상이고 표본의 SHARE_MIN 이상을 덮으면 같은 사람이다.
  화면 크기(w·h)·장면 간격(step)·시작 시각(start_s)은 달라도 된다 (좌표는 0~1로, 시각은 영상 시각으로 맞춘다).

옮기는 것
- 이름·등번호: 옛 선수에 이어진 새 트랙을 모두 한 선수로 합치고(되돌리기에 풀리지 않게 auto_merged=False) 대표에 붙인다.
  이름을 붙였거나 골키퍼로 정한 선수는 팀도 옛 값으로 둔다 (팀 색을 바꿔 홈·원정이 통째로 뒤집힌 경우는 다수결로 알아내 따라간다).
- 제외·심판(label="referee" + excluded)·골키퍼(label 끝이 _gk)·직접 합친 조각(merged_into, auto_merged=False).
- 직접 추가한 이벤트(선수는 그 시각 그 자리에 있던 새 트랙으로), 지우거나 고친 이벤트(같은 종류·같은 팀·±EVENT_WIN_S초에서 가장 가까운 새 이벤트).
옮기지 않는 것: 이름도 역할도 없는 선수의 팀 변경(엔진이 정한 값과 구별할 표시가 없다), AI 분석 글, 고친 이벤트의 시각.

옛·새 오버레이 중 하나라도 없으면 아무것도 옮기지 않는다. 어떤 오류가 나도 새 결과 저장은 그대로 된다.
"""

from __future__ import annotations

import base64
import gzip
import json
import logging
import math
from types import SimpleNamespace
from typing import Dict, Iterable, List, Optional, Set, Tuple

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.models import Match, MatchEvent, MatchPlayer
from app.services.result_service import _heads, _loads

logger = logging.getLogger(__name__)

IOU_MIN = 0.5          # 같은 시각 두 박스가 이만큼 겹치면 같은 사람
SHARE_MIN = 0.4        # 새 트랙 표본 중 이 비율 이상이 한 옛 선수와 겹쳐야 잇는다
MIN_VOTES = 3
MAX_SAMPLES = 40       # 새 트랙 하나에서 비교할 박스 수 (트랙 300개 × 16,000장면도 금방 끝난다)
EVENT_WIN_S = 1.5      # 지우거나 고친 이벤트를 새 이벤트와 맞출 때 허용하는 시각 차
PLAYER_WIN_S = 0.6     # 이벤트 시각 앞뒤 이만큼의 장면에서 그 선수 자리를 찾는다

Box = Tuple[float, float, float, float]
PLAYER_COLS = ("track_id", "team", "label", "excluded", "merged_into", "auto_merged", "display_name", "jersey_number")
EVENT_COLS = ("kind", "t", "t_end", "team", "player", "target", "x", "y", "x2", "y2", "success", "detail_json",
              "deleted", "manual", "edited")


class _Ov:
    """오버레이 한 벌. 박스는 0~1 좌표로, 장면 번호 k는 영상 시각 s0 + k*step."""

    def __init__(self, d: Dict):
        self.w, self.h = float(d.get("w") or 1), float(d.get("h") or 1)
        self.s0, self.step = float(d.get("start_s") or 0), float(d["step"])
        self.tracks: Dict[str, List[List[int]]] = d.get("tracks") or {}
        self.n = int(d.get("n") or 0) or max((b[0] for rows in self.tracks.values() for b in rows), default=-1) + 1
        if self.step <= 0:
            raise ValueError("오버레이 장면 간격이 올바르지 않습니다")

    def norm(self, b: List[int]) -> Box:
        return b[1] / self.w, b[2] / self.h, b[3] / self.w, b[4] / self.h

    def frames(self, ks: Set[int]) -> Dict[int, Dict[str, Box]]:
        """필요한 장면만 골라 {장면: {트랙: 박스}} — 전체를 한 번만 훑는다."""
        out: Dict[int, Dict[str, Box]] = {}
        for pid, rows in self.tracks.items():
            for b in rows:
                if b[0] in ks:
                    out.setdefault(b[0], {})[pid] = self.norm(b)
        return out


def _iou(a: Box, b: Box) -> float:
    ix = min(a[2], b[2]) - max(a[0], b[0])
    iy = min(a[3], b[3]) - max(a[1], b[1])
    if ix <= 0 or iy <= 0:
        return 0.0
    inter = ix * iy
    return inter / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter)


def _box_at(frames: Dict[int, Dict[str, Box]], pid: str, f: float) -> Optional[Box]:
    """장면 번호 f(소수)에서 pid의 박스. 앞뒤 장면에 다 있으면 그 사이를 잇고, 한쪽에만 있으면 반 걸음 안일 때만 쓴다."""
    k0 = math.floor(f)
    a = f - k0
    b0, b1 = frames.get(k0, {}).get(pid), frames.get(k0 + 1, {}).get(pid)
    if b0 and b1:
        return tuple(p + (q - p) * a for p, q in zip(b0, b1))
    return b0 if b0 and a <= 0.5 else b1 if b1 and a >= 0.5 else None


def match_tracks(old: _Ov, new: _Ov, ohead: Dict[str, str]) -> Dict[str, Tuple[str, int]]:
    """새 트랙 → (같은 사람인 옛 대표 트랙, 겹친 표본 수). 이을 수 없는 새 트랙은 빠진다."""
    lo, hi = old.s0 - old.step / 2, old.s0 + (old.n - 1) * old.step + old.step / 2   # 옛 분석이 본 구간만 비교한다
    samples: Dict[str, List[Tuple[float, Box]]] = {}
    for pid, rows in new.tracks.items():
        ok = [b for b in rows if lo <= new.s0 + b[0] * new.step <= hi]
        if len(ok) > MAX_SAMPLES:
            ok = [ok[i * len(ok) // MAX_SAMPLES] for i in range(MAX_SAMPLES)]
        if len(ok) >= MIN_VOTES:
            samples[pid] = [((new.s0 + b[0] * new.step - old.s0) / old.step, new.norm(b)) for b in ok]
    frames = old.frames({k for ss in samples.values() for f, _ in ss for k in (math.floor(f), math.floor(f) + 1)})
    out: Dict[str, Tuple[str, int]] = {}
    for pid, ss in samples.items():
        votes: Dict[str, int] = {}
        for f, box in ss:
            d0, d1 = frames.get(math.floor(f), {}), frames.get(math.floor(f) + 1, {})
            best, best_iou = None, IOU_MIN
            for cand in d0.keys() | d1.keys():
                p, q = d0.get(cand) or d1[cand], d1.get(cand) or d0[cand]
                if max(p[2], q[2]) <= box[0] or min(p[0], q[0]) >= box[2]:
                    continue   # 앞뒤 장면 모두 옆으로 벗어나 있다 — 겹칠 수 없으니 계산하지 않는다
                ob = _box_at(frames, cand, f)
                iou = _iou(box, ob) if ob else 0.0
                if iou >= best_iou:
                    best, best_iou = cand, iou
            if best is not None:
                g = ohead.get(best, best)
                votes[g] = votes.get(g, 0) + 1
        if votes:
            g, v = max(votes.items(), key=lambda kv: (kv[1], kv[0]))
            if v >= MIN_VOTES and v >= SHARE_MIN * len(ss):
                out[pid] = (g, v)
    return out


# ── 지우기 전: 옛 상태 적어 두기 ─────────────────────────────────────────────

def _user_made(p) -> bool:
    """사람만 만들 수 있는 상태 (골키퍼 표시는 엔진도 붙이므로 여기 넣지 않는다)."""
    return bool(p.display_name or p.jersey_number is not None or p.excluded or (p.merged_into and not p.auto_merged))


def snapshot(db: Session, match: Match) -> Optional[Dict]:
    """옛 선수·이벤트 행을 지우기 전에 부른다. 옮길 것이 없으면 None. 실패해도 예외를 내지 않는다."""
    try:
        # 필요한 칸만 읽는다 (썸네일까지 불러오지 않게)
        players = [SimpleNamespace(**dict(zip(PLAYER_COLS, r)))
                   for r in db.query(*(getattr(MatchPlayer, c) for c in PLAYER_COLS))
                   .filter(MatchPlayer.match_id == match.id).all()]
        events = [SimpleNamespace(**dict(zip(EVENT_COLS, r)))
                  for r in db.query(*(getattr(MatchEvent, c) for c in EVENT_COLS)).filter(
                      MatchEvent.match_id == match.id,
                      or_(MatchEvent.manual.is_(True), MatchEvent.deleted.is_(True), MatchEvent.edited.is_(True)))
                  .order_by(MatchEvent.t, MatchEvent.seq).all()]
        user = bool(events) or any(_user_made(p) for p in players)
        if not user and not any(_gk(p.label) for p in players):
            return None
        return {"players": players, "events": events, "overlay_gz": match.overlay_gz, "user": user}
    except Exception:  # noqa: BLE001 — 옮기기는 덤이다. 저장을 막지 않는다
        logger.exception("이전 작업 적어 두기 실패: match=%s", match.id)
        return None


# ── 새 결과를 넣은 뒤: 옮기기 ────────────────────────────────────────────────

def apply(db: Session, match: Match, snap: Optional[Dict], result: Dict) -> Optional[Dict]:
    """새 선수·이벤트 행을 넣고 엔진의 자동 합치기까지 끝난 뒤에 부른다. 옮긴 내용 요약을 돌려준다 (없으면 None).

    도중에 실패하면 옮기던 것을 모두 되돌려(세이브포인트) 새 결과만 그대로 저장되게 한다."""
    if not snap:
        return None
    db.flush()   # 새 결과 자체의 저장 오류는 여기서 그대로 드러난다
    try:
        with db.begin_nested():
            out = _apply(db, match, snap, result)
            db.flush()
        return out
    except Exception:  # noqa: BLE001
        logger.exception("이전 작업 옮기기 실패: match=%s", match.id)
        return {"skipped": "error"} if snap.get("user") else None


def _apply(db: Session, match: Match, snap: Dict, result: Dict) -> Optional[Dict]:
    skipped = lambda why: {"skipped": why} if snap["user"] else None  # noqa: E731
    if not snap["overlay_gz"] or not result.get("overlay"):
        return skipped("no_overlay")
    old = _Ov(json.loads(gzip.decompress(base64.b64decode(snap["overlay_gz"]))))
    new = _Ov(result["overlay"])
    olds = {p.track_id: p for p in snap["players"]}
    ohead = _heads(snap["players"])
    rows = db.query(MatchPlayer).filter(MatchPlayer.match_id == match.id).all()
    by = {r.track_id: r for r in rows}
    found = {n: gv for n, gv in match_tracks(old, new, ohead).items() if n in by and gv[0] in olds}
    if not found:
        return skipped("no_match")   # 다른 영상이거나 전혀 다르게 잡혔다 — 이벤트도 옮기지 않는다
    # 팀 색을 바꿔 다시 분석했으면 홈·원정이 통째로 뒤집힌다 → 이어진 트랙들의 다수결로 알아낸다
    agree = sum(v if by[n].team == olds[g].team else -v for n, (g, v) in found.items() if not olds[g].excluded)
    flip = {"home": "away", "away": "home"} if agree < 0 else {}
    out = _carry_players(olds, ohead, rows, found, flip)
    ev = _carry_events(db, match, snap["events"], old, new, ohead, rows, found, flip)
    out["unmatched"].update(ev.pop("unmatched"))
    out.update(ev)
    moved = sum(v for v in out.values() if isinstance(v, int)) + sum(out["unmatched"].values())
    return out if moved else None


def _gk(label: Optional[str]) -> bool:
    return (label or "").endswith("_gk")


def _carry_players(olds: Dict, ohead: Dict[str, str], rows: List[MatchPlayer], found: Dict[str, Tuple[str, int]],
                   flip: Dict[str, str]) -> Dict:
    """이름·등번호·역할·제외·합치기를 새 트랙으로. 옛 선수 한 명에 이어진 새 트랙은 한 선수(대표 하나)가 된다."""
    by = {r.track_id: r for r in rows}
    secs = {r.track_id: (float(_loads(r.stats_json, {}).get("seconds_tracked") or 0), r.track_id) for r in rows}
    omem: Dict[str, List[str]] = {}
    for tid, g in ohead.items():
        omem.setdefault(g, []).append(tid)
    # 옮길 것이 있는 옛 선수 → 이름·등번호가 있는지. soft: 엔진도 붙이는 골키퍼 표시만 있는 선수 (합치기는 되돌릴 수 있게 둔다)
    keep: Dict[str, bool] = {}
    soft: Set[str] = set()
    for g, mem in omem.items():
        o, named = olds[g], bool(olds[g].display_name or olds[g].jersey_number is not None)
        hard = named or o.excluded or any(olds[m].merged_into and not olds[m].auto_merged for m in mem)
        if hard or _gk(o.label):
            keep[g] = named
            soft |= set() if hard else {g}
    claim = {n: g for n, (g, _) in found.items() if g in keep}

    # 새 묶음 정하기. 서로 다른 옛 선수에 이어진 트랙은 엔진이 한 칸에 묶었더라도 갈라놓는다.
    # 엔진이 묶은 칸 안에 옮길 선수가 (제외 말고) 딱 한 명이면 그 칸의 나머지 조각도 그 선수를 따라간다.
    engine: Dict[str, List[str]] = {}
    for n, h in _heads(rows).items():
        engine.setdefault(h, []).append(n)
    groups: Dict[Tuple[str, str], List[str]] = {}
    for h, mem in engine.items():
        pos = {claim[n] for n in mem if n in claim and not olds[claim[n]].excluded}
        follow = next(iter(pos)) if len(pos) == 1 else None
        for n in mem:
            key = ("old", claim[n]) if n in claim else ("old", follow) if follow else ("engine", h)
            groups.setdefault(key, []).append(n)

    c = {"names": 0, "roles": 0, "teams": 0, "merges": 0}
    for (kind, g), mem in groups.items():
        direct = [n for n in mem if claim.get(n) == g] if kind == "old" else []
        # 대표: 옛 선수에 직접 이어진 트랙 중 가장 오래 잡힌 것. 엔진 칸은 원래 대표(빠져나갔으면 가장 오래 잡힌 것)
        lead = max(direct, key=secs.get) if direct else g if g in mem else max(mem, key=secs.get)
        fixed = direct if kind == "old" and g not in soft else []   # 사람이 한 작업으로 묶인 트랙
        for n in mem:
            r, into = by[n], (None if n == lead else lead)
            c["merges"] += bool(into and n in fixed and r.merged_into != into)
            r.merged_into, r.auto_merged = into, bool(into) and n not in fixed   # 따라온 엔진 조각은 되돌리기로 풀 수 있게
        if kind != "old":
            continue
        o, h = olds[g], by[lead]
        if o.display_name:
            h.display_name = o.display_name
        if o.jersey_number is not None:
            h.jersey_number = o.jersey_number
        c["names"] += keep[g]
        if o.excluded:
            h.excluded, h.label = True, ("referee" if o.label == "referee" else h.label)
            c["roles"] += 1
            continue
        team = flip.get(o.team, o.team) if (keep[g] or _gk(o.label)) else h.team
        new_gk = _gk(o.label) and not _gk(h.label)
        if team != h.team or new_gk:
            c["teams"] += team != h.team
            c["roles"] += new_gk
            h.team, h.label = team, team + ("_gk" if _gk(o.label) or _gk(h.label) else "")

    gone = [g for g in keep if g not in set(claim.values())]
    lost = [olds[g].display_name or f"#{olds[g].jersey_number}" for g in gone if keep[g]]
    c["unmatched"] = {"names": len(lost),
                      "roles": sum(1 for g in gone if not keep[g] and (olds[g].excluded or _gk(olds[g].label)))}
    if lost:
        c["lost_names"] = sorted(lost)[:30]
    return c


def _locate(reqs: Iterable[Tuple[str, float]], old: _Ov, new: _Ov, ohead: Dict[str, str]) -> Dict[Tuple[str, float], str]:
    """(옛 선수, 영상 시각) → 그 시각 앞뒤로 그 선수 자리에 가장 자주 있던 새 트랙."""
    omem: Dict[str, List[str]] = {}
    for tid, g in ohead.items():
        omem.setdefault(g, []).append(tid)
    span = {}
    for pid, tv in reqs:
        c, r = (tv - new.s0) / new.step, PLAYER_WIN_S / new.step
        span[(pid, tv)] = range(max(0, math.ceil(c - r)), math.floor(c + r) + 1)
    if not span:
        return {}
    fo = lambda k: (new.s0 + k * new.step - old.s0) / old.step  # noqa: E731 — 새 장면 k의 옛 장면 번호(소수)
    nks = {k for ks in span.values() for k in ks}
    nf, of = new.frames(nks), old.frames({j for k in nks for j in (math.floor(fo(k)), math.floor(fo(k)) + 1)})
    out = {}
    for (pid, tv), ks in span.items():
        votes: Dict[str, int] = {}
        for k in ks:
            for m in omem.get(ohead.get(pid, pid), [pid]):
                ob = _box_at(of, m, fo(k))
                iou, n = max(((_iou(ob, nb), n) for n, nb in nf.get(k, {}).items()), default=(0.0, None)) if ob else (0.0, None)
                if iou >= IOU_MIN:
                    votes[n] = votes.get(n, 0) + 1
        if votes:
            out[(pid, tv)] = max(votes.items(), key=lambda kv: (kv[1], kv[0]))[0]
    return out


def _carry_events(db: Session, match: Match, evs: List, old: _Ov, new: _Ov, ohead: Dict[str, str],
                  rows: List[MatchPlayer], found: Dict[str, Tuple[str, int]], flip: Dict[str, str]) -> Dict:
    """직접 추가한 이벤트는 다시 넣고, 지우거나 고친 이벤트는 같은 순간의 새 이벤트에 똑같이 적용한다."""
    c = {"manual_events": 0, "event_edits": 0, "unmatched": {"manual_events": 0, "event_edits": 0}}
    todo = [e for e in evs if not (e.manual and e.deleted)]   # 직접 넣었다가 지운 것은 없던 일
    if not todo:
        return c
    by, nhead = {r.track_id: r for r in rows}, _heads(rows)
    best: Dict[str, str] = {}   # 옛 선수 → 표가 가장 많은 새 트랙 (그 시각 자리를 못 찾을 때 쓴다)
    for n, (g, _) in sorted(found.items(), key=lambda kv: (kv[1][1], kv[0])):
        best[g] = n
    dt, end = old.s0 - new.s0, (new.n - 1) * new.step   # 이벤트 시각은 분석 시작점 기준 → 새 시작점 기준으로
    inside = lambda e: 0 <= e.t + dt <= end  # noqa: E731
    where = _locate({(pid, e.t + old.s0) for e in todo if inside(e) and not e.deleted
                     for pid in (e.player, e.target) if pid}, old, new, ohead)

    def pick(pid: str, tv: float) -> Optional[str]:
        n = where.get((pid, tv)) or nhead.get(best.get(ohead.get(pid, pid)))
        return n if n in by else None

    pool: Dict[Tuple[str, str], List[MatchEvent]] = {}
    if any(not e.manual for e in todo):
        for r in (db.query(MatchEvent).filter(MatchEvent.match_id == match.id, MatchEvent.kind != "possession")
                  .order_by(MatchEvent.t, MatchEvent.seq).all()):
            pool.setdefault((r.kind, r.team), []).append(r)
    last = db.query(func.max(MatchEvent.seq)).filter(MatchEvent.match_id == match.id).scalar()
    seq, used = (0 if last is None else last + 1), set()
    for e in todo:
        key = "manual_events" if e.manual else "event_edits"
        t, tv, ok, row, p, tg = e.t + dt, e.t + old.s0, inside(e), None, None, None
        if ok and not e.manual:
            row = min((r for r in pool.get((e.kind, flip.get(e.team, e.team)), [])
                       if r.id not in used and abs(r.t - t) <= EVENT_WIN_S), key=lambda r: abs(r.t - t), default=None)
            ok = row is not None
        if ok and not e.deleted:
            p, tg = pick(e.player, tv), (pick(e.target, tv) if e.target else None)
            ok = p is not None and (not e.target or (tg is not None and nhead[tg] != nhead[p]))
        if not ok:
            c["unmatched"][key] += 1
            continue
        c[key] += 1
        if e.manual:
            db.add(MatchEvent(match_id=match.id, seq=seq, kind=e.kind, t=t, t_end=None if e.t_end is None else e.t_end + dt,
                              team=by[nhead[p]].team, player=p, target=tg, x=e.x, y=e.y, x2=e.x2, y2=e.y2,
                              success=e.success, detail_json=e.detail_json or "{}", manual=True, edited=True))
            seq += 1
            continue
        used.add(row.id)
        if e.deleted:
            row.deleted = True
        else:   # 사람이 확인한 선수·받은 선수·결과를 그대로
            detail = _loads(row.detail_json, {})
            detail.update({k: v for k, v in _loads(e.detail_json, {}).items() if k in ("reason", "outcome")})
            row.player, row.target, row.success, row.detail_json = p, tg, e.success, json.dumps(detail)
        row.edited = True
    return c
