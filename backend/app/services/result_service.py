"""분석 결과 저장과 조회용 뷰 생성.

DB에는 원시값만 저장한다 — 트랙별 합산 가능한 통계(stats_json)와 이벤트.
팀 통계·패스 네트워크·점유율 추이·파생 지표는 조회할 때마다 다시 계산하므로
사용자가 트랙을 병합/제외하거나 팀을 바꿔도 모든 수치가 일관되게 반영된다.
"""

from __future__ import annotations

import csv
import io
import json
from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from app.models import Match, MatchEvent, MatchPlayer
from app.vision.events import Event, Spell
from app.vision.stats import (BALL_KEYS, add_event_stats, empty_stats, finalize, merge_player_stats,
                              pass_network, possession_timeline, team_stats)

CURRENT_VERSION = 2


def _loads(s: Optional[str], default):
    if not s:
        return default
    try:
        return json.loads(s)
    except (TypeError, ValueError):
        return default


# ── 저장 ────────────────────────────────────────────────────────────────────

def save_result(db: Session, match: Match, result: Dict, source: str) -> None:
    if result.get("version") != CURRENT_VERSION:
        raise ValueError("지원하지 않는 결과 형식입니다. 분석 워커 이미지를 최신 버전으로 갱신하세요.")
    db.query(MatchEvent).filter(MatchEvent.match_id == match.id).delete()
    db.query(MatchPlayer).filter(MatchPlayer.match_id == match.id).delete()
    db.flush()
    for p in result.get("players", []):
        db.add(MatchPlayer(
            match_id=match.id, track_id=p["track_id"], team=p["team"], label=p.get("label") or "",
            color_hex=p.get("color_hex"), thumbnail=p.get("thumbnail"), minor=bool(p.get("minor")),
            display_name=p.get("display_name"), jersey_number=p.get("jersey_number"),
            stats_json=json.dumps(p.get("stats") or {}),
        ))
    rows = []
    for i, e in enumerate(result.get("events", [])):
        rows.append(MatchEvent(
            match_id=match.id, seq=i, kind=e["kind"], t=e["t"], t_end=e.get("t_end"), team=e["team"],
            player=e["player"], target=e.get("target"), x=e.get("x"), y=e.get("y"),
            x2=e.get("x2"), y2=e.get("y2"), success=e.get("success"),
            detail_json=json.dumps(e.get("detail") or {}),
        ))
    db.add_all(rows)
    match.result_meta_json = json.dumps(result.get("meta") or {}, ensure_ascii=False)
    match.analysis_version = CURRENT_VERSION
    match.data_source = source
    match.status = "done"
    match.analysis_progress = 100.0
    match.analysis_message = "분석 완료"
    match.analysis_error = None


# ── 조회 뷰 ─────────────────────────────────────────────────────────────────

def _heads(rows: List[MatchPlayer]) -> Dict[str, str]:
    """track_id → 최종 병합 대상 track_id."""
    nxt = {r.track_id: r.merged_into for r in rows}
    out = {}
    for tid in nxt:
        cur, seen = tid, set()
        while nxt.get(cur) and nxt[cur] in nxt and cur not in seen:
            seen.add(cur)
            cur = nxt[cur]
        out[tid] = cur
    return out


def _remap_events(ev_rows: List[MatchEvent], head: Dict[str, str], team_of: Dict[str, str],
                  excluded: set) -> List[Event]:
    out: List[Event] = []
    for r in ev_rows:
        p = head.get(r.player, r.player)
        if p in excluded or p not in team_of:
            continue
        tgt = head.get(r.target, r.target) if r.target else None
        if tgt is not None and (tgt in excluded or tgt not in team_of):
            tgt = None
        team = team_of[p]
        detail = _loads(r.detail_json, {})
        success = r.success
        if r.kind == "pass":
            if tgt == p:
                continue  # 병합으로 자기 자신에게 한 패스가 됨 → 점유 지속
            if tgt is not None and detail.get("reason") != "out":
                success = team_of[tgt] == team
                if success:
                    detail.pop("reason", None)
                else:
                    detail["reason"] = "intercepted"
            elif tgt is None and detail.get("reason") == "intercepted":
                success = False
                detail["reason"] = "lost"
        elif r.kind == "recovery":
            if tgt == p or (tgt is not None and team_of[tgt] == team):
                continue
        elif r.kind == "shot":
            if tgt is not None and team_of[tgt] == team:
                tgt = None
        out.append(Event(r.kind, r.t, team, p, t_end=r.t_end, target=tgt, x=r.x, y=r.y,
                         x2=r.x2, y2=r.y2, success=success, detail=detail))
    return out


def _spells_from_events(events: List[Event]) -> List[Spell]:
    return [Spell(e.player, e.team, e.t, e.t_end if e.t_end is not None else e.t,
                  e.x or 0.0, e.y or 0.0, e.x or 0.0, e.y or 0.0)
            for e in events if e.kind == "possession"]


def build_view(db: Session, match: Match, include_events: bool = True) -> Dict:
    rows = db.query(MatchPlayer).filter(MatchPlayer.match_id == match.id).all()
    ev_rows = (db.query(MatchEvent).filter(MatchEvent.match_id == match.id)
               .order_by(MatchEvent.seq).all())
    meta = _loads(match.result_meta_json, {})
    head = _heads(rows)
    by_tid = {r.track_id: r for r in rows}
    heads = [r for r in rows if head[r.track_id] == r.track_id]
    excluded = {r.track_id for r in heads if r.excluded}
    team_of = {r.track_id: r.team for r in heads if not r.excluded}

    events = _remap_events(ev_rows, head, team_of, excluded)

    # 활동량은 병합된 트랙의 원시값을 더하고, 볼 기록은 이벤트에서 다시 센다
    members: Dict[str, List[Dict]] = {}
    for r in rows:
        members.setdefault(head[r.track_id], []).append(_loads(r.stats_json, {}))
    raw: Dict[str, Dict] = {}
    for tid in team_of:
        st = merge_player_stats(members.get(tid, []))
        for k in BALL_KEYS + ("pass_length_sum",):
            st[k] = 0
        raw[tid] = st
    add_event_stats(raw, events)
    for tid in list(raw):
        if tid not in team_of:
            raw.pop(tid)
        else:
            raw[tid]["team"] = team_of[tid]

    spells = _spells_from_events(events)
    duration = meta.get("duration_s") or (max((e.t_end or e.t) for e in events) if events else 0)

    players = []
    for r in heads:
        st = finalize(raw[r.track_id]) if r.track_id in raw else finalize(merge_player_stats(members.get(r.track_id, [])))
        st.pop("team", None)
        for k, v in list(st.items()):
            if isinstance(v, float):
                st[k] = round(v, 3)
        st["heat"] = [round(v, 2) for v in st["heat"]]
        merged_from = sorted(t for t, h in head.items() if h == r.track_id and t != r.track_id)
        players.append({
            "track_id": r.track_id,
            "team": r.team,
            "label": r.label,
            "color_hex": r.color_hex,
            "has_thumbnail": bool(r.thumbnail) or any(by_tid[t].thumbnail for t in merged_from),
            "minor": bool(r.minor) and not merged_from and st["touches"] == 0,
            "excluded": bool(r.excluded),
            "display_name": r.display_name,
            "jersey_number": r.jersey_number,
            "merged_from": merged_from,
            "stats": st,
        })
    players.sort(key=lambda p: (p["team"], p["excluded"], p["minor"], p["jersey_number"] or 999, p["track_id"]))

    active_stats = {tid: st for tid, st in raw.items()}
    out = {
        "version": match.analysis_version or 0,
        "meta": meta,
        "players": players,
        "team_stats": team_stats(active_stats, spells),
        "pass_network": pass_network(events, active_stats),
        "possession_timeline": possession_timeline(spells, duration),
    }
    if include_events:
        out["events"] = [dict(e.to_dict(), id=i) for i, e in enumerate(events) if e.kind != "possession"]
        out["possessions"] = [[round(e.t, 2), round(e.t_end or e.t, 2), e.team, e.player]
                              for e in events if e.kind == "possession"]
    return out


def thumbnail_for(db: Session, match_id: int, track_id: str) -> Optional[str]:
    rows = db.query(MatchPlayer).filter(MatchPlayer.match_id == match_id).all()
    head = _heads(rows)
    group = [r for r in rows if head[r.track_id] == track_id and r.thumbnail]
    if not group:
        return None
    # 가장 오래 잡힌 트랙의 썸네일
    group.sort(key=lambda r: -(_loads(r.stats_json, {}).get("seconds_tracked") or 0))
    return group[0].thumbnail


# ── 내보내기 ────────────────────────────────────────────────────────────────

CSV_COLUMNS = [
    ("팀", lambda p, s, m: m.home_team_name if p["team"] == "home" else m.away_team_name),
    ("트랙", lambda p, s, m: p["track_id"]),
    ("이름", lambda p, s, m: p["display_name"] or ""),
    ("등번호", lambda p, s, m: p["jersey_number"] or ""),
    ("포지션", lambda p, s, m: "GK" if p["label"].endswith("_gk") else ""),
    ("출전(분)", lambda p, s, m: s["minutes_tracked"]),
    ("볼터치", lambda p, s, m: s["touches"]),
    ("점유시간(초)", lambda p, s, m: round(s["possession_s"], 1)),
    ("패스시도", lambda p, s, m: s["passes_attempted"]),
    ("패스성공", lambda p, s, m: s["passes_completed"]),
    ("패스실패", lambda p, s, m: s["passes_failed"]),
    ("패스성공률(%)", lambda p, s, m: s["pass_accuracy"] if s["pass_accuracy"] is not None else ""),
    ("전진패스", lambda p, s, m: s["forward_passes"]),
    ("받은패스", lambda p, s, m: s["passes_received"]),
    ("슈팅", lambda p, s, m: s["shots"]),
    ("유효슈팅", lambda p, s, m: s["shots_on_target"]),
    ("xG", lambda p, s, m: round(s["xg"], 2)),
    ("가로채기", lambda p, s, m: s["interceptions"]),
    ("볼탈취", lambda p, s, m: s["recoveries"]),
    ("볼뺏김", lambda p, s, m: s["dispossessed"]),
    ("이동거리(m)", lambda p, s, m: round(s["distance_m"])),
    ("스프린트거리(m)", lambda p, s, m: round(s["sprint_m"])),
    ("스프린트횟수", lambda p, s, m: s["sprint_count"]),
    ("최고속도(km/h)", lambda p, s, m: s["top_speed_kmh"]),
]


def export_csv(match: Match, view: Dict) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow([c[0] for c in CSV_COLUMNS])
    for p in view["players"]:
        if p["excluded"] or p["minor"]:
            continue
        w.writerow([fn(p, p["stats"], match) for _, fn in CSV_COLUMNS])
    return "﻿" + buf.getvalue()  # Excel 한글 깨짐 방지 BOM


def empty_player_stats() -> Dict:
    return finalize(empty_stats())
