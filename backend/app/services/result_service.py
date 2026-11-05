"""분석 결과 저장과 조회용 뷰 생성.

DB에는 원시값만 저장한다 — 트랙별 합산 가능한 통계(stats_json)와 이벤트.
팀 통계·패스 네트워크·점유율 추이·파생 지표는 조회할 때마다 다시 계산하므로
사용자가 트랙을 병합/제외하거나 팀을 바꾸거나 이벤트를 고쳐도 모든 수치가 일관되게 반영된다.
"""

from __future__ import annotations

import csv
import io
import json
from typing import Dict, List, Optional, Tuple

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


# ── 영상 검수 오버레이 ───────────────────────────────────────────────────────

def pack_overlay(overlay: Dict) -> str:
    import base64
    import gzip
    raw = json.dumps(overlay, separators=(",", ":")).encode()
    return base64.b64encode(gzip.compress(raw, 6)).decode()


def overlay_gzip_bytes(match: Match) -> Optional[bytes]:
    """저장된 오버레이를 gzip 바이트 그대로 돌려준다 (응답에 Content-Encoding: gzip으로 실어 보낸다)."""
    import base64
    if not match.overlay_gz:
        return None
    try:
        return base64.b64decode(match.overlay_gz)
    except (ValueError, TypeError):
        return None


# ── 저장 ────────────────────────────────────────────────────────────────────

def _clean_detail(d: Dict) -> Dict:
    """워커가 numpy 참/거짓을 글자("True"/"False")로 저장한 경우(v2.0.6) 진짜 참/거짓으로 되돌린다.
    그대로 두면 "False"도 참으로 읽혀 전진 패스·유효 슈팅이 부풀려진다."""
    return {k: (v == "True") if v in ("True", "False") else v for k, v in (d or {}).items()}


def save_result(db: Session, match: Match, result: Dict, source: str) -> None:
    if result.get("version") != CURRENT_VERSION:
        raise ValueError("지원하지 않는 결과 형식입니다. 분석 워커 이미지를 최신 버전으로 갱신하세요.")
    db.query(MatchEvent).filter(MatchEvent.match_id == match.id).delete()
    db.query(MatchPlayer).filter(MatchPlayer.match_id == match.id).delete()
    db.flush()
    for p in result.get("players", []):
        db.add(MatchPlayer(
            match_id=match.id, track_id=p["track_id"], team=p["team"], label=p.get("label") or "",
            color_hex=p.get("color_hex"), thumbnail=p.get("thumbnail"), minor=p.get("minor") in (True, "True"),
            display_name=p.get("display_name"), jersey_number=p.get("jersey_number"),
            stats_json=json.dumps(p.get("stats") or {}),
        ))
    # 분석이 팀당 정원(필드 10 + GK 1)에 맞춰 묶은 조각 — 되돌릴 수 있는 자동 합치기로 저장
    db.flush()
    slots = (result.get("meta") or {}).get("roster_slots") or {}
    if slots:
        by_id = {r.track_id: r for r in db.query(MatchPlayer).filter(MatchPlayer.match_id == match.id).all()}
        for pid, lead in slots.items():
            if pid != lead and pid in by_id and lead in by_id:
                by_id[pid].merged_into, by_id[pid].auto_merged = lead, True
    rows = []
    for i, e in enumerate(result.get("events", [])):
        rows.append(MatchEvent(
            match_id=match.id, seq=i, kind=e["kind"], t=e["t"], t_end=e.get("t_end"), team=e["team"],
            player=e["player"], target=e.get("target"), x=e.get("x"), y=e.get("y"),
            x2=e.get("x2"), y2=e.get("y2"), success=e.get("success"),
            detail_json=json.dumps(_clean_detail(e.get("detail"))),
        ))
    db.add_all(rows)
    match.result_meta_json = json.dumps(result.get("meta") or {}, ensure_ascii=False)
    overlay = result.get("overlay")
    match.overlay_gz = pack_overlay(overlay) if overlay else None
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
                  excluded: set, untrusted_bounds: bool = False) -> List[Tuple[MatchEvent, Event]]:
    """DB 이벤트 → 병합/제외/팀 변경을 반영한 이벤트. (원본 행, 이벤트) 쌍.

    untrusted_bounds: 보정 없이 카메라가 움직인 영상. 예전 엔진은 화면 밖으로 사라진 공을 '아웃'으로 보고
    그 뒤 점유를 모두 세트피스로 셌다 (경기 1: 21분에 102개). 공이 멈춘 근거가 없는 그런 세트피스는 뺀다."""
    out: List[Tuple[MatchEvent, Event]] = []
    for r in ev_rows:
        if r.deleted:
            continue
        if untrusted_bounds and r.kind == "set_piece" and not r.manual:
            d = _loads(r.detail_json, {})
            if d.get("still_s") is None and d.get("type") not in ("whistle", "kick_off"):
                continue
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
                detail["reason"] = "completed" if success else "intercepted"
            elif tgt is None and detail.get("reason") in ("intercepted", "completed", None):
                success = False
                detail["reason"] = "lost"
        elif r.kind == "recovery":
            if tgt == p or (tgt is not None and team_of[tgt] == team):
                continue
        elif r.kind == "shot":
            if tgt is not None and team_of[tgt] == team:
                tgt = None
            success = detail.get("outcome") == "on_target"
        out.append((r, Event(r.kind, r.t, team, p, t_end=r.t_end, target=tgt, x=r.x, y=r.y,
                             x2=r.x2, y2=r.y2, success=success, detail=detail)))
    return out


def _spells_from_events(events: List[Event]) -> List[Spell]:
    return [Spell(e.player, e.team, e.t, e.t_end if e.t_end is not None else e.t,
                  e.x or 0.0, e.y or 0.0, e.x or 0.0, e.y or 0.0)
            for e in events if e.kind == "possession"]


def halftime_rel(match: Match, meta: Dict) -> Optional[float]:
    """후반 시작 시각을 이벤트 시각 기준(분석 시작점 기준)으로."""
    if match.halftime_s is None:
        return None
    return match.halftime_s - float(meta.get("start_s") or 0.0)


def load_event_rows(db: Session, match_id: int) -> List[MatchEvent]:
    return (db.query(MatchEvent).filter(MatchEvent.match_id == match_id)
            .order_by(MatchEvent.t, MatchEvent.seq).all())


def build_view(db: Session, match: Match, include_events: bool = True, period: Optional[int] = None) -> Dict:
    """period: None=전체, 1=전반, 2=후반 (경기 설정에 후반 시작 시각이 있어야 함)."""
    rows = db.query(MatchPlayer).filter(MatchPlayer.match_id == match.id).all()
    ev_rows = load_event_rows(db, match.id)
    meta = _loads(match.result_meta_json, {})
    head = _heads(rows)
    by_tid = {r.track_id: r for r in rows}
    heads = [r for r in rows if head[r.track_id] == r.track_id]
    excluded = {r.track_id for r in heads if r.excluded}
    team_of = {r.track_id: r.team for r in heads if not r.excluded}

    untrusted = bool(meta.get("camera_moving")) and not meta.get("calibrated")
    pairs = _remap_events(ev_rows, head, team_of, excluded, untrusted_bounds=untrusted)
    ht = halftime_rel(match, meta)
    duration = meta.get("duration_s") or (max((e.t_end or e.t) for _, e in pairs) if pairs else 0)
    t_from, t_to = 0.0, float(duration or 0)
    if period in (1, 2) and ht is not None:
        if period == 1:
            pairs = [(r, e) for r, e in pairs if e.t < ht]
            t_to = min(t_to, ht)
        else:
            pairs = [(r, e) for r, e in pairs if e.t >= ht]
            t_from = max(0.0, ht)
    events = [e for _, e in pairs]

    # 출전 시간·평균 위치는 병합된 트랙의 원시값을 더하고, 볼 기록은 이벤트에서 다시 센다
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

    players = []
    for r in heads:
        st = finalize(raw[r.track_id]) if r.track_id in raw else finalize(merge_player_stats(members.get(r.track_id, [])))
        st.pop("team", None)
        for k, v in list(st.items()):
            if isinstance(v, float):
                st[k] = round(v, 3)
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

    timeline = possession_timeline([Spell(sp.tid, sp.team, sp.t0 - t_from, sp.t1 - t_from, 0, 0, 0, 0)
                                    for sp in spells], max(0.0, t_to - t_from))
    for b in timeline:
        b["start_s"] = round(b["start_s"] + t_from, 1)
        b["end_s"] = round(b["end_s"] + t_from, 1)
    out = {
        "version": match.analysis_version or 0,
        "meta": dict(meta, halftime_rel_s=ht),
        "period": period if (period in (1, 2) and ht is not None) else None,
        "players": players,
        "team_stats": team_stats(raw, spells),
        "pass_network": pass_network(events, raw),
        "possession_timeline": timeline,
    }
    if include_events:
        out["events"] = [dict(e.to_dict(), id=r.id, manual=bool(r.manual), edited=bool(r.edited))
                         for r, e in pairs if e.kind != "possession"]
        out["possessions"] = [[round(e.t, 2), round(e.t_end or e.t, 2), e.team, e.player]
                              + ([e.detail["contested"]] if (e.detail or {}).get("contested") else [])
                              for e in events if e.kind == "possession"]
    return out


def head_player(db: Session, match_id: int, track_id: str) -> Optional[MatchPlayer]:
    """track_id가 다른 트랙에 병합돼 있으면 최종 병합 대상(대표) 트랙의 행. 없는 트랙이면 None."""
    rows = db.query(MatchPlayer).filter(MatchPlayer.match_id == match_id).all()
    by_tid = {r.track_id: r for r in rows}
    if track_id not in by_tid:
        return None
    return by_tid[_heads(rows)[track_id]]


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
    ("키패스", lambda p, s, m: s["key_passes"]),
    ("받은패스", lambda p, s, m: s["passes_received"]),
    ("슈팅", lambda p, s, m: s["shots"]),
    ("유효슈팅", lambda p, s, m: s["shots_on_target"]),
    ("xG", lambda p, s, m: round(s["xg"], 2)),
    ("가로채기", lambda p, s, m: s["interceptions"]),
    ("볼탈취", lambda p, s, m: s["recoveries"]),
    ("볼뺏김", lambda p, s, m: s["dispossessed"]),
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
