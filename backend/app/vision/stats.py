"""선수·팀 통계 집계.

모든 선수 통계는 '더할 수 있는' 형태로 저장한다(합계, 가중합, 격자 카운트).
그래서 끊긴 트랙 여러 개를 한 선수로 합칠 때 merge_player_stats()로 정확히 합산된다.

활동량(이동거리) 개편:
  - 위치 잡음이 거리를 부풀리지 않도록 0.6초 이동평균 후 미분
  - 11 m/s(약 40km/h)를 넘는 순간 이동은 추적 오류로 보고 버림
  - 속도 구간별 거리: 걷기 <2, 조깅 2–4, 러닝 4–5.5, 스프린트 ≥5.5 m/s
  - 최고 속도는 1초 평균 속도의 최댓값(순간 튐 제거)
  - '활동 범위 점수' 대신 경기장 격자 히트맵(체류 시간)을 저장
"""

from __future__ import annotations

import math
from collections import defaultdict
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

from .events import Event, Frame, Spell

SPEED_ZONES = (("walk", 0.0, 2.0), ("jog", 2.0, 4.0), ("run", 4.0, 5.5), ("sprint", 5.5, float("inf")))
MAX_HUMAN_SPEED = 11.0
SPRINT_MIN_S = 1.0
HEAT_COLS, HEAT_ROWS = 12, 8

BALL_KEYS = ("touches", "possession_s", "passes_attempted", "passes_completed", "passes_failed",
             "passes_received", "forward_passes", "shots", "shots_on_target", "shots_blocked",
             "interceptions", "recoveries", "dispossessed")
PHYS_KEYS = ("distance_m", "walk_m", "jog_m", "run_m", "sprint_m", "sprint_count", "seconds_tracked")
SUM_KEYS = BALL_KEYS + PHYS_KEYS + ("pos_sum_x", "pos_sum_y", "pos_weight", "pass_length_sum")


def empty_stats() -> Dict:
    d = {k: 0 for k in SUM_KEYS}
    d.update({"top_speed_ms": 0.0, "heat": [0.0] * (HEAT_COLS * HEAT_ROWS),
              "first_seen_s": None, "last_seen_s": None})
    return d


# ── 활동량 ───────────────────────────────────────────────────────────────────

def _smooth(points: Sequence[Tuple[float, float, float, float]], half_window: float = 0.3):
    out = []
    n = len(points)
    lo = 0
    hi = 0
    sx = sy = 0.0
    for i in range(n):
        t = points[i][0]
        while hi < n and points[hi][0] <= t + half_window:
            sx += points[hi][1]
            sy += points[hi][2]
            hi += 1
        while points[lo][0] < t - half_window:
            sx -= points[lo][1]
            sy -= points[lo][2]
            lo += 1
        cnt = hi - lo
        out.append((t, sx / cnt, sy / cnt, points[i][3]))
    return out


def physical_stats(points: Sequence[Tuple[float, float, float, float]], length: float, width: float,
                   max_gap_s: float = 1.5, chord_s: float = 0.6, still_speed: float = 0.4) -> Dict:
    """points: [(t, x, y, s)] 시간순. 경기장 좌표 + 국소 축척.

    거리는 0.6초 이상 떨어진 점 사이 직선(chord)으로 재고, 0.4 m/s 미만 움직임은
    제자리 흔들림으로 보고 버린다 — 프레임마다 더하면 추적 잡음이 거리로 쌓인다.
    """
    st = empty_stats()
    if not points:
        return st
    pts = sorted(points, key=lambda p: p[0])
    st["first_seen_s"], st["last_seen_s"] = pts[0][0], pts[-1][0]
    sm = _smooth(pts)

    # 체류 시간(히트맵·평균 위치)은 모든 점으로
    for (t0, x0, y0, _), (t1, x1, y1, _) in zip(sm, sm[1:]):
        dt = t1 - t0
        if dt <= 0 or dt > max_gap_s:
            continue
        st["seconds_tracked"] += dt
        mx, my = (x0 + x1) / 2, (y0 + y1) / 2
        col = min(HEAT_COLS - 1, max(0, int(mx / length * HEAT_COLS)))
        row = min(HEAT_ROWS - 1, max(0, int(my / width * HEAT_ROWS)))
        st["heat"][row * HEAT_COLS + col] += dt
        st["pos_sum_x"] += mx / length * dt
        st["pos_sum_y"] += my / width * dt
        st["pos_weight"] += dt

    # 이동거리·속도는 chord 단위로
    speeds: List[Tuple[float, float]] = []
    sprint_run = 0.0
    sprint_counted = False
    anchor = sm[0]
    prev_t = sm[0][0]
    for pt in sm[1:]:
        t1 = pt[0]
        if t1 - prev_t > max_gap_s:  # 추적이 끊김 — 새로 시작
            anchor, prev_t = pt, t1
            sprint_run, sprint_counted = 0.0, False
            continue
        prev_t = t1
        dt = t1 - anchor[0]
        if dt < chord_s:
            continue
        d = math.hypot(pt[1] - anchor[1], pt[2] - anchor[2]) * (anchor[3] + pt[3]) / 2
        v = d / dt
        anchor = pt
        if v > MAX_HUMAN_SPEED:
            sprint_run, sprint_counted = 0.0, False
            continue
        speeds.append((t1, v))
        if v < still_speed:
            sprint_run, sprint_counted = 0.0, False
            continue
        st["distance_m"] += d
        for name, lo, hi in SPEED_ZONES:
            if lo <= v < hi:
                st[f"{name}_m"] += d
                break
        if v >= SPEED_ZONES[3][1]:
            sprint_run += dt
            if sprint_run >= SPRINT_MIN_S and not sprint_counted:
                st["sprint_count"] += 1
                sprint_counted = True
        else:
            sprint_run, sprint_counted = 0.0, False

    # 최고 속도: 1초 이상 이어진 구간의 평균 속도 최댓값(순간 튐 제거)
    lo = 0
    acc = 0.0
    for i, (t, v) in enumerate(speeds):
        acc += v
        while speeds[lo][0] < t - 1.2:
            acc -= speeds[lo][1]
            lo += 1
        if i > lo:
            st["top_speed_ms"] = max(st["top_speed_ms"], acc / (i - lo + 1))
    return st


# ── 볼 이벤트 ────────────────────────────────────────────────────────────────

def add_event_stats(stats: Dict[str, Dict], events: Iterable[Event]) -> None:
    def g(tid: str) -> Dict:
        return stats.setdefault(tid, empty_stats())

    for e in events:
        if e.kind == "possession":
            s = g(e.player)
            s["touches"] += 1
            s["possession_s"] += (e.t_end or e.t) - e.t
        elif e.kind == "pass":
            s = g(e.player)
            s["passes_attempted"] += 1
            if e.success:
                s["passes_completed"] += 1
                s["pass_length_sum"] += e.detail.get("length_m", 0.0)
                if e.detail.get("forward"):
                    s["forward_passes"] += 1
                if e.target:
                    g(e.target)["passes_received"] += 1
            else:
                s["passes_failed"] += 1
                if e.target and e.detail.get("reason") == "intercepted":
                    g(e.target)["interceptions"] += 1
        elif e.kind == "shot":
            s = g(e.player)
            s["shots"] += 1
            if e.success:
                s["shots_on_target"] += 1
            if e.detail.get("outcome") == "blocked":
                s["shots_blocked"] += 1
        elif e.kind == "recovery":
            g(e.player)["recoveries"] += 1
            if e.target:
                g(e.target)["dispossessed"] += 1


def finalize(st: Dict) -> Dict:
    """파생 지표를 붙인 사본."""
    out = dict(st)
    att = st["passes_attempted"]
    out["pass_accuracy"] = round(st["passes_completed"] / att * 100, 1) if att else None
    out["avg_pass_length_m"] = round(st["pass_length_sum"] / st["passes_completed"], 1) if st["passes_completed"] else None
    w = st["pos_weight"]
    out["avg_x"] = round(st["pos_sum_x"] / w, 4) if w else None
    out["avg_y"] = round(st["pos_sum_y"] / w, 4) if w else None
    out["top_speed_kmh"] = round(st["top_speed_ms"] * 3.6, 1)
    out["minutes_tracked"] = round(st["seconds_tracked"] / 60, 1)
    return out


def merge_player_stats(items: Sequence[Dict]) -> Dict:
    st = empty_stats()
    for it in items:
        for k in SUM_KEYS:
            st[k] += it.get(k, 0) or 0
        st["top_speed_ms"] = max(st["top_speed_ms"], it.get("top_speed_ms", 0) or 0)
        heat = it.get("heat") or []
        for i, v in enumerate(heat[: len(st["heat"])]):
            st["heat"][i] += v
        for key, fn in (("first_seen_s", min), ("last_seen_s", max)):
            vals = [v for v in (st[key], it.get(key)) if v is not None]
            st[key] = fn(vals) if vals else None
    return st


def compute_player_stats(frames: Sequence[Frame], events: Sequence[Event],
                         length: float, width: float) -> Dict[str, Dict]:
    """선수별 원시(합산 가능) 통계. 키에 'team' 포함."""
    traj: Dict[str, List[Tuple[float, float, float, float]]] = defaultdict(list)
    team_of: Dict[str, str] = {}
    for f in frames:
        for p in f.players:
            traj[p.tid].append((f.t, p.x, p.y, p.s))
            team_of[p.tid] = p.team
    stats: Dict[str, Dict] = {tid: physical_stats(pts, length, width) for tid, pts in traj.items()}
    add_event_stats(stats, events)
    for tid, st in stats.items():
        st["team"] = team_of.get(tid, "home")
    return stats


# ── 팀 단위 ─────────────────────────────────────────────────────────────────

def team_stats(player_stats: Dict[str, Dict], spells: Sequence[Spell]) -> Dict[str, Dict]:
    out = {}
    poss = {"home": 0.0, "away": 0.0}
    for sp in spells:
        if sp.team in poss:
            poss[sp.team] += sp.duration
    total_poss = sum(poss.values())
    for team in ("home", "away"):
        members = [s for s in player_stats.values() if s.get("team") == team]
        agg = merge_player_stats(members)
        fin = finalize(agg)
        out[team] = {
            "possession_pct": round(poss[team] / total_poss * 100, 1) if total_poss else None,
            "possession_s": round(poss[team], 1),
            "players": len(members),
            **{k: fin[k] for k in ("passes_attempted", "passes_completed", "passes_failed", "pass_accuracy",
                                    "forward_passes", "shots", "shots_on_target", "shots_blocked",
                                    "interceptions", "recoveries", "dispossessed", "touches",
                                    "sprint_count")},
            "distance_m": round(agg["distance_m"], 1),
            "sprint_m": round(agg["sprint_m"], 1),
            "heat": [round(v, 1) for v in agg["heat"]],
        }
    return out


def pass_network(events: Sequence[Event], player_stats: Dict[str, Dict], min_passes: int = 1) -> Dict[str, Dict]:
    """팀별 {nodes:[{id,x,y,touches}], edges:[{a,b,count}]} — 좌표는 0~1 정규화(평균 위치)."""
    edges: Dict[str, Dict[Tuple[str, str], int]] = {"home": defaultdict(int), "away": defaultdict(int)}
    for e in events:
        if e.kind == "pass" and e.success and e.target and e.team in edges:
            key = tuple(sorted((e.player, e.target)))
            edges[e.team][key] += 1
    out = {}
    for team in ("home", "away"):
        ids = {tid for pair, c in edges[team].items() if c >= min_passes for tid in pair}
        nodes = []
        for tid in sorted(ids):
            st = finalize(player_stats.get(tid, empty_stats()))
            if st["avg_x"] is None:
                continue
            nodes.append({"id": tid, "x": st["avg_x"], "y": st["avg_y"], "touches": st["touches"]})
        node_ids = {n["id"] for n in nodes}
        out[team] = {
            "nodes": nodes,
            "edges": [{"a": a, "b": b, "count": c} for (a, b), c in sorted(edges[team].items())
                      if c >= min_passes and a in node_ids and b in node_ids],
        }
    return out


def possession_timeline(spells: Sequence[Spell], duration_s: float, bins: Optional[int] = None) -> List[Dict]:
    """구간별 홈 점유율(%) — 구간 길이는 경기 길이에 맞춰 1~5분."""
    if duration_s <= 0:
        return []
    if bins is None:
        bin_s = 300.0 if duration_s >= 1800 else max(60.0, duration_s / 10)
    else:
        bin_s = duration_s / bins
    n = max(1, int(math.ceil(duration_s / bin_s)))
    home = [0.0] * n
    away = [0.0] * n
    for sp in spells:
        t = sp.t0
        while t < sp.t1:
            i = min(n - 1, int(t // bin_s))
            seg_end = min(sp.t1, (i + 1) * bin_s)
            (home if sp.team == "home" else away)[i] += seg_end - t
            t = seg_end
    out = []
    for i in range(n):
        tot = home[i] + away[i]
        out.append({"start_s": round(i * bin_s, 1), "end_s": round(min(duration_s, (i + 1) * bin_s), 1),
                    "home_pct": round(home[i] / tot * 100, 1) if tot else None})
    return out
