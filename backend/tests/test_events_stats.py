
import pytest

from app.vision.events import EventConfig, Frame, PlayerObs, detect_events
from app.vision.simulate import simulate_match
from app.vision.stats import (
    add_event_stats, compute_player_stats, empty_stats, finalize, merge_player_stats,
    pass_network, possession_timeline, presence_stats, team_stats,
)

R = 1.6


def _frames(duration, fps, players_fn, ball_fn):
    out = []
    n = int(duration * fps) + 1
    for i in range(n):
        t = round(i / fps, 3)
        ps = [PlayerObs(tid, team, x, y, R, 1.0) for tid, team, x, y in players_fn(t)]
        out.append(Frame(t, ps, ball_fn(t)))
    return out


def _lerp(a, b, f):
    return (a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f)


def test_simple_pass_between_teammates():
    a, b = (40.0, 30.0), (60.0, 30.0)

    def players(t):
        return [("H1", "home", *a), ("H2", "home", *b), ("A1", "away", 50.0, 50.0), ("A2", "away", 80.0, 40.0)]

    def ball(t):
        if t < 2.0:
            return (a[0] + 0.5, a[1])
        if t < 3.0:  # 20m를 1초에 (20 m/s)
            return _lerp((a[0] + 0.5, a[1]), (b[0] - 0.5, b[1]), t - 2.0)
        return (b[0] - 0.5, b[1])

    events, spells, _ = detect_events(_frames(5, 5, players, ball), EventConfig())
    passes = [e for e in events if e.kind == "pass"]
    assert len(passes) == 1
    p = passes[0]
    assert (p.player, p.target, p.success) == ("H1", "H2", True)
    assert p.detail["length_m"] == pytest.approx(19, abs=1.5)
    assert p.detail["forward"] is True   # 홈팀이 오른쪽으로 공격 (평균 x가 더 작음)
    assert [s.tid for s in spells] == ["H1", "H2"]


def test_interception_and_tackle():
    def players(t):
        a2 = (55.0, 30.0) if t < 5 else (60.5, 30.0)
        return [("H1", "home", 40.0, 30.0), ("H2", "home", 70.0, 30.0), ("A1", "away", 55.0, 30.0 if t < 3 else 31.0),
                ("A2", "away", *a2)]

    def ball(t):
        if t < 1.0:
            return (40.5, 30.0)
        if t < 2.0:  # H1이 H2에게 찼지만 A1이 중간에서 끊음
            return _lerp((40.5, 30.0), (54.6, 30.0), t - 1.0)
        return (54.6, 30.0) if t < 3 else (54.6, 31.0)

    events, _, _ = detect_events(_frames(4, 5, players, ball), EventConfig())
    fails = [e for e in events if e.kind == "pass"]
    assert len(fails) == 1 and fails[0].success is False
    assert fails[0].detail["reason"] == "intercepted" and fails[0].target == "A1"

    # 몸싸움으로 빼앗기 (공이 날지 않음)
    def players2(t):
        return [("H1", "home", 40.0 + t, 30.0), ("A1", "away", 41.6 + t if t >= 2 else 45.0, 30.0)]

    def ball2(t):
        return (40.5 + t, 30.0) if t < 2.0 else (41.4 + t, 30.0)

    ev2, _, _ = detect_events(_frames(4, 5, players2, ball2), EventConfig())
    rec = [e for e in ev2 if e.kind == "recovery"]
    assert len(rec) == 1 and (rec[0].player, rec[0].target) == ("A1", "H1")
    assert not [e for e in ev2 if e.kind == "pass"]


def test_shot_on_target_and_off_target():
    def make(aim_y):
        def players(t):
            return [("H9", "home", 85.0, 34.0), ("H2", "home", 30.0, 30.0), ("A1", "away", 104.0, 34.0),
                    ("A5", "away", 70.0, 30.0)]

        def ball(t):
            if t < 1.0:
                return (85.5, 34.0)
            f = min(1.0, (t - 1.0) / 1.0)  # 1초에 골라인 도달 (~20m/s)
            return _lerp((85.5, 34.0), (105.5, aim_y), f)
        return players, ball

    on, _, _ = detect_events(_frames(3, 5, *make(35.5)), EventConfig())
    shots = [e for e in on if e.kind == "shot"]
    assert len(shots) == 1 and shots[0].success is True and shots[0].detail["outcome"] == "on_target"

    off, _, _ = detect_events(_frames(3, 5, *make(40.5)), EventConfig())
    shots = [e for e in off if e.kind == "shot"]
    assert len(shots) == 1 and shots[0].success is False
    assert not [e for e in off if e.kind == "pass"]


def test_long_unknown_gap_creates_no_guess():
    def players(t):
        return [("H1", "home", 40.0, 30.0), ("A1", "away", 70.0, 30.0)]

    def ball(t):
        if t < 1:
            return (40.5, 30.0)
        if t < 5:
            return None          # 4초 동안 공 미검출
        return (69.5, 30.0)

    ev, _, _ = detect_events(_frames(7, 5, players, ball), EventConfig())
    assert not [e for e in ev if e.kind in ("pass", "recovery")]
    assert len([e for e in ev if e.kind == "possession"]) == 2


def test_attack_direction_override_and_halftime():
    def players(t):
        return [("H1", "home", 80.0, 30.0), ("A1", "away", 20.0, 30.0)]

    frames = _frames(10, 2, players, lambda t: None)
    from app.vision.events import attack_dir, resolve_attack_direction
    cfg = EventConfig(halftime_s=5)
    d = resolve_attack_direction(frames, cfg)
    assert attack_dir(d, "home", 1, cfg) == -1 and attack_dir(d, "home", 6, cfg) == 1
    cfg2 = EventConfig(home_attacks="right")
    d2 = resolve_attack_direction(frames, cfg2)
    assert attack_dir(d2, "home", 1, cfg2) == 1


@pytest.mark.parametrize("seed", [11, 12])
def test_detector_accuracy_on_simulated_match(seed):
    sim = simulate_match(duration_s=900, seed=seed)
    events, _, _ = detect_events(sim.frames, EventConfig(length=sim.length, width=sim.width))

    def score(kind):
        det = [e for e in events if e.kind == kind]
        truth = [e for e in sim.truth if e.kind == kind]
        used, tp, ok = set(), 0, 0
        for te in truth:
            m = [i for i, de in enumerate(det) if i not in used and de.player == te.player and abs(de.t - te.t) <= 1.0]
            if m:
                i = min(m, key=lambda i: abs(det[i].t - te.t))
                used.add(i)
                tp += 1
                ok += det[i].success == te.success
        return tp / max(1, len(truth)), tp / max(1, len(det)), ok / max(1, tp)

    poss = score("possession")
    passes = score("pass")
    shots = score("shot")
    assert poss[0] >= 0.95 and poss[1] >= 0.95
    assert passes[0] >= 0.93 and passes[1] >= 0.93 and passes[2] >= 0.95
    assert shots[0] >= 0.6 and shots[1] >= 0.8
    rec = score("recovery")
    assert rec[0] >= 0.7


def test_presence_stats_time_and_average_position():
    pts = [(i * 0.2, 52.5, 34.0, 1.0) for i in range(101)]  # 20초 동안 센터서클
    st = presence_stats(pts, 105, 68)
    assert st["seconds_tracked"] == pytest.approx(20, abs=0.01)
    fin = finalize(st)
    assert fin["avg_x"] == pytest.approx(0.5) and fin["avg_y"] == pytest.approx(0.5)
    assert fin["minutes_tracked"] == pytest.approx(0.3, abs=0.01)
    # 추적이 끊긴 구간은 출전 시간에 넣지 않는다
    gap = [(0, 10.0, 10.0, 1.0), (1, 10.0, 10.0, 1.0), (10, 10.0, 10.0, 1.0), (11, 10.0, 10.0, 1.0)]
    assert presence_stats(gap, 105, 68)["seconds_tracked"] == pytest.approx(2)
    assert "distance_m" not in st and "heat" not in st


def test_merge_is_additive():
    a = presence_stats([(i, i * 3.0, 10.0, 1.0) for i in range(10)], 105, 68)
    b = presence_stats([(20 + i, 50 + i * 4.0, 10.0, 1.0) for i in range(10)], 105, 68)
    a["touches"], b["touches"] = 3, 4
    a["xg"], b["xg"] = 0.25, 0.5
    m = merge_player_stats([a, b])
    assert m["seconds_tracked"] == pytest.approx(a["seconds_tracked"] + b["seconds_tracked"])
    assert m["touches"] == 7 and m["xg"] == pytest.approx(0.75)
    assert m["first_seen_s"] == 0 and m["last_seen_s"] == 29


def test_key_pass_counts_pass_followed_by_receiver_shot():
    from app.vision.events import Event
    ev = [
        Event("pass", 10, "home", "A", t_end=11, target="B", success=True, detail={"length_m": 12}),
        Event("shot", 14, "home", "B", success=True, detail={"outcome": "on_target", "xg": 0.3}),
        Event("pass", 30, "home", "A", t_end=31, target="C", success=True),
        Event("recovery", 33, "away", "X", target="C"),
        Event("shot", 35, "home", "C", success=False, detail={"outcome": "off_target"}),   # 중간에 뺏김 → 키패스 아님
        Event("pass", 50, "home", "D", t_end=51, target="B", success=True),
        Event("shot", 70, "home", "B", success=False, detail={"outcome": "off_target"}),   # 너무 늦음
    ]
    st = {}
    add_event_stats(st, ev)
    assert st["A"]["key_passes"] == 1 and st["D"]["key_passes"] == 0
    assert st["B"]["shots"] == 2 and st["B"]["xg"] == pytest.approx(0.3)


def test_full_stats_pipeline_on_simulation():
    sim = simulate_match(duration_s=600, seed=5)
    events, spells, _ = detect_events(sim.frames, EventConfig(length=sim.length, width=sim.width))
    ps = compute_player_stats(sim.frames, events, sim.length, sim.width)
    assert len(ps) == 22
    ts = team_stats(ps, spells)
    assert ts["home"]["possession_pct"] + ts["away"]["possession_pct"] == pytest.approx(100, abs=0.2)
    total_pass = sum(1 for e in events if e.kind == "pass")
    assert ts["home"]["passes_attempted"] + ts["away"]["passes_attempted"] == total_pass
    fin = finalize(ps["H7"])
    assert fin["passes_attempted"] == fin["passes_completed"] + fin["passes_failed"]
    assert 0 <= fin["avg_x"] <= 1 and fin["minutes_tracked"] > 9
    # 골키퍼 평균 위치는 자기 골문 근처
    gk = finalize(ps["H1"])
    assert min(gk["avg_x"], 1 - gk["avg_x"]) < 0.2
    assert ts["home"]["key_passes"] + ts["away"]["key_passes"] >= 1
    net = pass_network(events, ps)
    assert net["home"]["nodes"] and net["home"]["edges"]
    tl = possession_timeline(spells, sim.duration_s)
    assert len(tl) == 10 and all(b["home_pct"] is None or 0 <= b["home_pct"] <= 100 for b in tl)


def test_event_stats_counts():
    from app.vision.events import Event
    st = {}
    add_event_stats(st, [
        Event("possession", 0, "home", "H1", t_end=2),
        Event("pass", 2, "home", "H1", target="H2", success=True, detail={"length_m": 10, "forward": True}),
        Event("pass", 5, "home", "H2", target="A1", success=False, detail={"reason": "intercepted"}),
        Event("recovery", 8, "away", "A2", target="H1"),
        Event("shot", 9, "away", "A2", success=True, detail={"outcome": "on_target"}),
    ])
    assert st["H1"]["passes_completed"] == 1 and st["H1"]["dispossessed"] == 1 and st["H1"]["possession_s"] == 2
    assert st["H2"]["passes_received"] == 1 and st["H2"]["passes_failed"] == 1
    assert st["A1"]["interceptions"] == 1
    assert st["A2"]["recoveries"] == 1 and st["A2"]["shots_on_target"] == 1
    assert finalize(st["H2"])["pass_accuracy"] == 0.0
    assert finalize(empty_stats())["pass_accuracy"] is None


def test_set_piece_corner_detected_after_still_ball():
    corner = (0.6, 0.6)
    recv = (19.5, 10.0)

    def players(t):
        h1 = (1.2, 1.2) if t >= 2.0 else (6.0, 6.0)      # 2초부터 코너로 걸어와 선다
        return [("H1", "home", *h1), ("H2", "home", 20.0, 10.0), ("A1", "away", 50.0, 30.0), ("A2", "away", 80.0, 40.0)]

    def ball(t):
        if t < 3.0:
            return corner                                 # 공이 코너에 멈춰 있다
        if t < 4.0:
            return _lerp(corner, recv, t - 3.0)           # 코너킥
        return recv

    frames = _frames(7, 5, players, ball)
    events, spells, _ = detect_events(frames, EventConfig(calibrated=True))
    sps = [e for e in events if e.kind == "set_piece"]
    assert [(e.player, e.detail["type"]) for e in sps] == [("H1", "corner")]
    assert sps[0].detail["still_s"] >= 0.7
    st = compute_player_stats(frames, events, 105.0, 68.0)
    ts = team_stats(st, spells)
    assert (ts["home"]["corners"], ts["home"]["set_pieces"], ts["away"]["set_pieces"]) == (1, 1, 0)

    # 보정이 없으면 위치를 믿지 않으므로 종류 없이 '재개'로만 센다
    events_u, _, _ = detect_events(frames, EventConfig(calibrated=False))
    sps_u = [e for e in events_u if e.kind == "set_piece"]
    assert [e.detail["type"] for e in sps_u] == ["restart"]


def test_set_piece_free_kick_and_throw_in_by_location():
    def scenario(spot):
        def players(t):
            a1 = (spot[0] + 0.8, spot[1] + 0.8) if t >= 2.0 else (spot[0] + 8, spot[1] + 8)
            return [("A1", "away", *a1), ("A2", "away", 70.0, 34.0), ("H1", "home", 30.0, 34.0), ("H2", "home", 20.0, 20.0)]

        def ball(t):
            if t < 3.0:
                return spot
            if t < 4.0:
                return _lerp(spot, (70.0, 34.0), t - 3.0)
            return (70.0, 34.0)
        events, _, _ = detect_events(_frames(7, 5, players, ball), EventConfig(calibrated=True))
        return [(e.player, e.detail["type"]) for e in events if e.kind == "set_piece"]

    assert scenario((50.0, 30.0)) == [("A1", "free_kick")]
    assert scenario((50.0, 0.8)) == [("A1", "throw_in")]


def test_possession_timeline_spell_past_duration_terminates():
    """점유 구간이 경기 길이를 넘어도(반올림 차이) 끝나야 한다 — 예전에는 무한 반복에 빠졌다."""
    from app.vision.events import Spell
    sp = [Spell("H1", "home", 590.0, 600.4, 0, 0, 0, 0, 1.0), Spell("A1", "away", 10.0, 70.0, 0, 0, 0, 0, 1.0)]
    out = possession_timeline(sp, 600.0)
    assert out and out[-1]["home_pct"] == 100.0
    assert [b["home_pct"] for b in out[:3]] == [0.0, 0.0, None]  # 10~70초 원정 점유는 두 구간에 걸친다
