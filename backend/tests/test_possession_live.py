"""점유율: 경기가 멈춘 시간을 빼고 '공을 잡은 횟수'로 센다. 골: 킥오프 재개로 영상 확인."""
from app.services.result_service import confirm_goals, dead_windows, live_spells
from app.vision.events import Event, Spell
from app.vision.stats import possession_timeline, team_stats


def sp(team, t0, t1, tid="P1"):
    return Spell(tid, team, t0, t1, 0, 0, 0, 0)


def test_dead_windows_from_whistle_and_goal():
    events = [Event("set_piece", 30.0, "away", "P9", detail={"type": "whistle", "whistle_t": 22.0}),
              Event("set_piece", 80.0, "home", "P1", detail={"type": "restart"})]      # 호루라기 없음 → 구간 없음
    meta = {"scoreboard": {"found": True, "goals": [{"t": 95.0, "t_board": 100.0, "team": "away"}]},
            "kickoffs": [{"t": 0.0, "after_goal": None}, {"t": 125.0, "after_goal": 100.0}]}
    assert dead_windows(events, meta) == [(22.0, 30.0), (95.0, 125.0)]


def test_live_spells_drop_and_clip():
    wins = [(22.0, 30.0)]
    spells = [sp("home", 10, 12), sp("away", 20, 26), sp("away", 23, 29), sp("home", 31, 33)]
    live = live_spells(spells, wins)
    assert [(s.team, s.t0, s.t1) for s in live] == [("home", 10, 12), ("away", 20, 22.0), ("home", 31, 33)]


def test_possession_by_touch_ignores_long_hold():
    # 원정이 프리킥을 기다리며 26초 서 있었다: 시간으로는 원정 압도, 횟수로는 2:2
    spells = [sp("home", 0, 1), sp("home", 2, 3), sp("away", 4, 5), sp("away", 10, 36)]
    by_time = team_stats({}, spells)
    by_touch = team_stats({}, spells, by_touch=True)
    assert by_time["home"]["possession_pct"] < 10
    assert by_touch["home"]["possession_pct"] == 50.0
    assert by_touch["away"]["possession_touches"] == 2
    assert by_touch["away"]["possession_s"] == 27.0      # 시간은 그대로 남긴다
    tl = possession_timeline(spells, 60.0, bins=1, by_touch=True)
    assert tl[0]["home_pct"] == 50.0


def test_confirm_goals_by_kickoff():
    meta = {"scoreboard": {"found": True, "score": {"home": 1, "away": 1}, "goals": [
                {"t": 90.0, "t_board": 95.0, "team": "away"},      # 뒤에 홈이 킥오프 → 영상 확인
                {"t": 300.0, "t_board": 305.0, "team": "home"},    # 킥오프를 못 찾음 → 자막뿐
                {"t": 500.0, "t_board": 505.0, "team": "home"}]},  # 킥오프를 넣은 팀이 함 → 어긋남
            "kickoffs": [{"t": 120.0, "after_goal": 95.0}, {"t": 530.0, "after_goal": 505.0}]}
    spells = [sp("home", 122.0, 124.0), sp("home", 531.0, 533.0)]
    goals = confirm_goals(meta, spells)["goals"]
    assert [g["video_confirmed"] for g in goals] == [True, False, False]
    assert [g["kickoff_t"] for g in goals] == [120.0, None, 530.0]
    assert confirm_goals({"scoreboard": {"found": False}}, spells) == {"found": False}


def test_drop_excursions_removes_short_detour_only():
    from app.vision.ball import drop_excursions
    times = [i / 15 for i in range(40)]
    pos = [(100.0 + 5 * i, 500.0) for i in range(40)]          # 공이 천천히 오른쪽으로 굴러간다
    for i in range(10, 16):                                     # 0.4초 동안 엉뚱한 곳(신발)을 공으로 잡음
        pos[i] = (1400.0 + i, 200.0)
    out = drop_excursions(list(pos), times, frame_w=1920)
    assert all(out[i] is None for i in range(10, 16))
    assert all(out[i] == pos[i] for i in list(range(10)) + list(range(16, 40)))
    # 진짜로 멀리 간 공(돌아오지 않음)은 그대로 둔다
    far = [(100.0, 500.0)] * 10 + [(1400.0, 200.0)] * 30
    assert drop_excursions(list(far), times, frame_w=1920) == far


def test_apply_goals_turns_last_kick_into_goal_shot():
    from types import SimpleNamespace as NS
    from app.services.result_service import apply_goals
    row = lambda **kw: NS(manual=False, edited=False, **kw)
    # 월넛 골(9:07 자막): 박스 안 슈팅이 '원정 선수에게 간 실패 패스'로 잡혀 있었다 → 골 슈팅으로
    fail = Event("pass", 545.07, "home", "P340", t_end=546.53, target="P10", success=False)
    early = Event("pass", 533.47, "home", "P695", t_end=534.8, target="P426", success=True)
    # 바모스 골(1:35 자막): 직전 슈팅이 '블록'으로 잡혀 있었다 → 유효(골)로
    shot = Event("shot", 90.33, "away", "P227", detail={"outcome": "blocked", "xg": 0.01})
    edited = Event("pass", 700.0, "home", "P9", success=False)
    pairs = [(row(), shot), (row(), early), (row(), fail), (NS(manual=False, edited=True), edited)]
    meta = {"scoreboard": {"found": True, "goals": [
        {"t": 90.33, "t_board": 95.0, "team": "away", "player": "P227"},
        {"t": 547.0, "t_board": 547.0, "team": "home", "player": None},
        # 사람이 고친 패스뿐 → 그 패스는 그대로 두고, 득점자를 모르는 골 슈팅을 하나 만든다
        {"t": 705.0, "t_board": 705.0, "team": "home", "player": None}]}}
    out = apply_goals(pairs, meta)["scoreboard"]["goals"]
    assert (fail.kind, fail.success, fail.target, fail.detail["goal"]) == ("shot", True, None, True)
    assert (shot.success, shot.detail["outcome"], shot.detail["goal"]) == (True, "on_target", True)
    assert early.kind == "pass" and edited.kind == "pass"
    assert [(g["t"], g["player"]) for g in out] == [(90.33, "P227"), (545.07, "P340"), (703.0, None)]
    made = [(r, e) for r, e in pairs if getattr(r, "id", 0) < 0]
    assert [(e.kind, e.player, e.success, e.x) for _, e in made] == [("shot", "", True, None)]
    assert apply_goals(pairs, {"scoreboard": {"found": False}}) == {"scoreboard": {"found": False}}


def test_apply_goals_falls_back_to_last_touch_only_if_recent():
    """슈팅·실패 패스가 없으면: 자막 6초 안에 끝난 그 팀 점유 → 그 선수의 골 슈팅, 더 오래전이면 득점자 미확인.
    2쿼터(재분석 뒤) 9:05 P411 점유 → 9:07 자막(맞음), 1:25 미드필드 P6 점유 → 1:35 자막(틀림, 카메라가 돈 사이 골)."""
    from types import SimpleNamespace as NS
    from app.services.result_service import apply_goals
    row = NS(manual=False, edited=False)
    near = Event("possession", 541.67, "home", "P411", t_end=545.4, x=90, y=30, x2=95, y2=33)
    far = Event("possession", 84.8, "away", "P6", t_end=85.13, x=60, y=30)
    pairs = [(row, far), (row, near)]
    meta = {"scoreboard": {"found": True, "goals": [
        {"t_board": 95.0, "team": "away"}, {"t_board": 547.0, "team": "home"}]}}
    out = apply_goals(pairs, meta)["scoreboard"]["goals"]
    assert [(g["t"], g["player"]) for g in out] == [(93.0, None), (545.4, "P411")]
    shots = [e for _, e in pairs if e.kind == "shot"]
    assert [(e.team, e.player, e.success, e.x, e.y) for e in shots] == [("away", "", True, None, None), ("home", "P411", True, 95, 33)]
    assert [e.t for _, e in pairs] == sorted(e.t for _, e in pairs)
