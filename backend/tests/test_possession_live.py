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
