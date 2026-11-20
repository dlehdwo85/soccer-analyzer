"""경기장 선 자동 인식과 그 위치로 하는 판정: 변환, 골키퍼, 센터서클 킥오프, 재개 종류·파울, 형광 조끼 심판, 이동 거리."""
import numpy as np

from app.vision import color as C
from app.vision import pitchreg as R
from app.vision.events import Frame, PlayerObs
from app.vision.pipeline import goals_from_kickoffs, kickoffs, whistle_restarts
from app.vision.situations import centre_kickoffs, find_goalkeepers, foul_player, restart_type
from app.vision.stats import add_event_stats, empty_stats, finalize, merge_player_stats, presence_stats

L, W = 105.0, 68.0
# 경기장(m) → 화면(px): 비스듬히 내려다보는 카메라를 흉내 낸 변환
H_INV = np.array([[14.0, 6.0, 150.0], [0.5, 9.0, 220.0], [0.0, 0.004, 1.0]])


def kps_for(h_inv, ids, noise=0.0, seed=0):
    rng = np.random.default_rng(seed)
    t = R.template(L, W)
    px = R._apply(h_inv, t[ids]) + rng.normal(0, noise, (len(ids), 2))
    return [(int(i), float(x), float(y), 0.9) for i, (x, y) in zip(ids, px)]


def test_fit_frame_recovers_positions():
    ids = [0, 1, 2, 6, 9, 10, 13, 14, 15, 30]
    f = R.fit_frame(kps_for(H_INV, ids, noise=1.0), R.template(L, W), 1920)
    assert f is not None and f.n >= 8
    p = R._apply(f.h, R._apply(H_INV, np.array([[30.0, 40.0]])))[0]
    assert np.hypot(p[0] - 30.0, p[1] - 40.0) < 0.5


def test_fit_frame_rejects_few_or_collinear_points():
    t = R.template(L, W)
    assert R.fit_frame(kps_for(H_INV, [0, 1, 2, 6]), t, 1920) is None            # 4점뿐
    assert R.fit_frame(kps_for(H_INV, [13, 14, 15, 16]) + kps_for(H_INV, [16]), t, 1920) is None   # 하프라인 한 줄


def test_one_wrong_point_is_ignored():
    ids = [0, 1, 2, 6, 9, 10, 13, 14]
    k = kps_for(H_INV, ids)
    k[3] = (k[3][0], k[3][1] + 300, k[3][2] + 200, 0.9)      # 번호를 잘못 붙인 점 하나
    f = R.fit_frame(k, R.template(L, W), 1920)
    assert f is not None and f.n == 7 and 6 not in f.ids


def test_registrar_bridges_gaps_with_camera_motion():
    reg = R.PitchRegistrar(1920, 1080, L, W, every=5)
    times = [i / 5 for i in range(80)]
    shift = lambda k: np.array([[1, 0, 4.0 * k], [0, 1, 0], [0, 0, 1.0]])      # 카메라가 오른쪽으로 도는 중: 화면은 왼쪽으로 민다
    cam_T = [shift(k) for k in range(80)]                                        # 현재 화면 → 기준 화면
    ids = [0, 1, 2, 6, 9, 10, 13, 14, 15, 30]
    for k in (0, 5, 10, 60):                                                     # 10~60 사이(10초)는 선이 안 보였다
        h_inv_k = np.linalg.inv(cam_T[k]) @ H_INV                                # 그 장면의 경기장 → 화면
        reg.add_keypoints(k, kps_for(h_inv_k, ids))
    info = reg.finish(cam_T, times, fixed_dims=True)
    assert info["anchors"] == 4 and info["median_err_px"] < 1.0
    px = (np.linalg.inv(cam_T[7]) @ np.append(R._apply(H_INV, np.array([[50.0, 30.0]]))[0], 1.0))[:2]
    p = reg.to_pitch(7, px[0], px[1])                                            # 변환이 없는 장면 — 앞뒤 장면에서 옮겨 온다
    assert p is not None and np.hypot(p[0] - 50.0, p[1] - 30.0) < 0.3
    assert reg.to_pitch(35, 100, 100) is None                                    # 4초 넘게 선이 없던 한가운데는 위치를 내지 않는다
    assert 30 < info["covered_pct"] < 100


def test_estimate_dims_prefers_real_size():
    ids = list(range(32))
    t = R.template(95.0, 60.0)
    frames = []
    for s in range(12):
        px = R._apply(H_INV, t[ids])
        frames.append([(i, float(x), float(y), 0.9) for i, (x, y) in zip(ids, px)])
    Lh, Wh, n = R.estimate_dims(frames, 1920, (105.0, 68.0))
    assert (Lh, Wh) == (95.0, 60.0) and n > 25
    # 기본 크기와 차이가 없으면 기본 크기를 그대로 쓴다
    t2 = R.template(105.0, 68.0)
    same = [[(i, float(x), float(y), 0.9) for i, (x, y) in zip(ids, R._apply(H_INV, t2[ids]))] for _ in range(12)]
    assert R.estimate_dims(same, 1920, (105.0, 68.0))[:2] == (105.0, 68.0)


def chain(team, t0, t1, x, y, step=0.5):
    n = int((t1 - t0) / step)
    return team, [(t0 + i * step, x + 0.3 * np.sin(i), y + 0.3 * np.cos(i)) for i in range(n)]


def test_goalkeeper_is_the_one_who_stays_in_the_box():
    chains = {
        "gk_h1": chain("home", 0, 40, 4.0, 34.0), "gk_h2": chain("home", 200, 240, 6.0, 30.0),
        "gk_a": chain("away", 100, 150, 100.0, 35.0),
        "def_h": chain("home", 10, 30, 12.0, 25.0),            # 같은 시간 박스 안에 있던 수비수 — 골문에서 더 멀다
        "corner_h": chain("home", 60, 80, 5.0, 15.0),          # 박스 모서리 쪽에 서 있던 수비수 — 골문 앞이 아니다
        "mid_h": chain("home", 0, 300, 50.0, 30.0), "fwd_a": chain("away", 0, 30, 10.0, 40.0),   # 원정 공격수가 홈 박스에
    }
    gks, info = find_goalkeepers(chains, L, W)
    assert gks == {"gk_h1": "home", "gk_h2": "home", "gk_a": "away"}
    assert info["home_side"] == "left"
    assert find_goalkeepers({"mid_h": chains["mid_h"]}, L, W) == ({}, None)     # 근거가 없으면 정하지 않는다


def test_goalkeeper_team_follows_the_goal_not_the_kit():
    from app.vision.situations import home_goal_side
    # 월넛 골키퍼가 어두운 옷이라 원정(바모스)으로 분류됐다 — 그래도 월넛 골문(왼쪽) 앞에 있었으니 월넛 골키퍼다
    chains = {
        "dark_gk_left": chain("away", 0, 300, 4.0, 34.0),
        "away_gk_right": chain("away", 0, 200, 101.0, 33.0),
        "home_mid": chain("home", 0, 300, 40.0, 30.0), "away_mid": chain("away", 0, 300, 62.0, 30.0),
    }
    assert home_goal_side(chains, L) == "left"
    gks, info = find_goalkeepers(chains, L, W, home_side="left")
    assert gks == {"dark_gk_left": "home", "away_gk_right": "away"} and info["home_side"] == "left"
    # 위치 근거 없이 옷 색만 보면 두 골키퍼가 다 원정이라 한쪽만 맞힌다 — 그래서 위치로 정한다
    gks2, _ = find_goalkeepers(chains, L, W)
    assert gks2 != gks


def frame(t, ball, home_xs, away_xs):
    ps = [PlayerObs(f"H{i}", "home", x, 20 + 5 * i, 1.6) for i, x in enumerate(home_xs)]
    ps += [PlayerObs(f"A{i}", "away", x, 20 + 5 * i, 1.6) for i, x in enumerate(away_xs)]
    return Frame(t, ps, ball)


def test_centre_kickoff_needs_ball_on_spot_and_teams_in_own_halves():
    home, away = [10, 25, 30, 40, 51.5], [60, 70, 75, 90, 54]       # 킥오프하는 홈 선수 한 명은 선 위
    frames = [frame(t / 5, (52.5, 34.0), home, away) for t in range(0, 15)]                       # 0~3초: 진짜 킥오프
    frames += [frame(3 + t / 5, (60 + t, 30.0), home, away) for t in range(0, 300)]               # 공이 떠남
    frames += [frame(100 + t / 5, (52.0, 34.5), [10, 60, 70, 40, 51], away) for t in range(0, 15)]  # 공은 가운데지만 섞여 있음
    ks = centre_kickoffs(frames, L, W)
    assert len(ks) == 1 and ks[0]["home_dir"] == 1 and 2.5 <= ks[0]["t"] <= 3.0


def test_kickoffs_and_video_only_goal():
    home, away = [10, 25, 30, 40, 51.5], [60, 70, 75, 90, 54]
    frames = [frame(t / 5, (52.5, 34.0), home, away) for t in range(0, 15)]
    frames += [frame(3 + t / 5, (80.0, 30.0), home, away) for t in range(0, 1500)]
    frames += [frame(303 + t / 5, (52.5, 34.0), home, away) for t in range(0, 15)]                # 5분 3초: 다시 킥오프
    frames += [frame(306 + t / 5, (30.0, 30.0), home, away) for t in range(0, 50)]
    ks = kickoffs(frames, {"found": False}, None, pitch=(L, W))
    assert [bool(k.get("video_only")) for k in ks] == [False, True]
    events = [{"kind": "shot", "t": 280.0, "team": "home", "player": "H3"},
              {"kind": "possession", "t": 306.5, "team": "away", "player": "A4"}]       # 원정이 킥오프 → 홈이 넣었다
    sb = goals_from_kickoffs(ks, events)
    assert sb["source"] == "video" and sb["score"] == {"home": 1, "away": 0}
    assert sb["goals"][0]["player"] == "H3" and ks[1]["after_goal"] == sb["goals"][0]["t_board"]


def test_restart_type_by_position():
    assert restart_type(1.0, 1.5, L, W) == "corner"
    assert restart_type(40.0, 67.0, L, W) == "throw_in"
    assert restart_type(4.0, 30.0, L, W, own_goal_x=0.0) == "goal_kick"
    assert restart_type(4.0, 30.0, L, W, own_goal_x=L) == "free_kick"       # 상대 골문 앞 — 골킥일 수 없다
    assert restart_type(94.0, 34.0, L, W) == "penalty"
    assert restart_type(52.0, 34.0, L, W) == "kick_off"
    assert restart_type(60.0, 20.0, L, W) == "free_kick"


def test_whistle_restart_becomes_free_kick_with_foul():
    frames = [Frame(49.5, [PlayerObs("A7", "away", 61.0, 21.0, 1.6), PlayerObs("H3", "home", 60.5, 20.0, 1.6),
                           PlayerObs("A2", "away", 80.0, 40.0, 1.6)], (60.0, 20.0))]
    events = [{"kind": "possession", "t": 58.0, "team": "home", "player": "H3", "x": 60.0, "y": 20.0},
              {"kind": "possession", "t": 120.0, "team": "away", "player": "A2", "x": 30.0, "y": 67.5}]
    out = whistle_restarts(events, [(50.0, 0.4, 300.0), (110.0, 0.4, 300.0)], {}, frames=frames, pitch=(L, W),
                           attack={"first": {"home": 1, "away": -1}})
    sps = [e for e in out if e["kind"] == "set_piece"]
    assert [(e["detail"]["type"], e["team"], e["target"]) for e in sps] == [("free_kick", "home", "A7"), ("throw_in", "away", None)]
    assert sps[0]["detail"]["foul"] is True and "foul" not in sps[1]["detail"]
    # 위치를 모르면(선 인식 없음) 예전처럼 '호루라기 뒤 재개'로만 남긴다
    plain = [e for e in whistle_restarts(events, [(50.0, 0.4, 300.0)], {}) if e["kind"] == "set_piece"]
    assert plain[0]["detail"]["type"] == "whistle" and plain[0]["target"] is None
    assert foul_player(frames, 50.0, "home") == "H3"


def test_foul_counted_for_the_fouling_player():
    from app.vision.events import Event
    stats = {}
    add_event_stats(stats, [Event("set_piece", 58.0, "home", "H3", target="A7", detail={"type": "free_kick", "foul": True}),
                            Event("set_piece", 90.0, "home", "H3", detail={"type": "penalty"})])
    assert stats["A7"]["fouls"] == 1 and stats["H3"]["free_kicks"] == 1 and stats["H3"]["penalties"] == 1


def test_neon_vest_is_referee_unless_a_team_wears_it():
    rng = np.random.default_rng(0)
    neon = np.clip(np.array([168, 200, 58]) + rng.normal(0, 6, (200, 3)), 0, 255)
    blue = np.clip(np.array([150, 200, 235]) + rng.normal(0, 6, (200, 3)), 0, 255)
    grass = np.clip(np.array([70, 120, 45]) + rng.normal(0, 6, (200, 3)), 0, 255)
    assert C.neon_fraction_rgb(neon) > 0.9 and C.neon_fraction_rgb(blue) < 0.05 and C.neon_fraction_rgb(grass) < 0.05

    def sample(px, neon_frac):
        lab = C.rgb_to_lab(px)
        return C.JerseySample(np.median(lab, axis=0), lab, 1.0, None, neon_frac)
    clf = C.TeamColorClassifier.from_match("#96c8eb", "#111827")
    assert clf.classify(sample(neon, 0.95))[0] == C.REFEREE
    assert clf.classify(sample(blue, 0.0))[0] == C.HOME
    # 조끼 입은 사람이 여럿이면(조끼 팀) 심판으로 보지 않는다
    clf2 = C.TeamColorClassifier.from_match("#96c8eb", "#111827")
    clf2.calibrate([sample(neon, 0.95)] * 8 + [sample(blue, 0.0)] * 12)
    assert clf2.neon_referee is False and clf2.classify(sample(neon, 0.95))[0] != C.REFEREE


def test_distance_uses_one_second_averages():
    rng = np.random.default_rng(1)
    # 5m/s로 10초 달림, 장면마다 ±0.3m 떨림 (초당 15장면)
    pts = [(i / 15, 10 + 5 * i / 15 + rng.normal(0, 0.3), 30 + rng.normal(0, 0.3), 1.0) for i in range(150)]
    st = presence_stats(pts, L, W, metric=True)
    assert 40 <= st["distance_m"] <= 50                    # 실제 45m (떨림을 장면 단위로 더하면 80m를 넘는다)
    assert 4.0 <= st["top_speed_ms"] <= 5.6
    assert "distance_m" not in presence_stats(pts, L, W)    # 미터 좌표가 아니면 재지 않고 항목도 만들지 않는다
    m = merge_player_stats([st, dict(empty_stats(), distance_m=100.0, top_speed_ms=7.0), empty_stats()])
    f = finalize(m)
    assert f["top_speed_kmh"] == 25.2 and f["distance_km"] == round((st["distance_m"] + 100) / 1000, 2)
    assert "distance_km" not in finalize(merge_player_stats([empty_stats()]))
