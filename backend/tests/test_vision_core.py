import numpy as np
import pytest

from app.vision import color as C
from app.vision.ball import interpolate_gaps, select_ball_positions
from app.vision.pitch import POSSESSION_RADIUS_H, PitchMapper, apply_h, calibration_from_preset, homography
from app.vision.tracker import Detection, IoUTracker, Tracklet, stitch_tracklets

GRASS = (60, 140, 60)


def _frame_with_players(players, w=400, h=200):
    """players: [(x1, y1, colors)], colors 1개면 단색, 2개면 세로 줄무늬."""
    img = np.zeros((h, w, 3), dtype=np.uint8)
    img[:] = GRASS
    boxes = []
    for x1, y1, cols in players:
        bw, bh = 20, 50
        for dx in range(bw):
            col = cols[(dx // 3) % len(cols)]
            img[y1:y1 + bh, x1 + dx] = col
        img[y1 + 35:y1 + bh, x1:x1 + bw] = (30, 30, 30)  # 반바지
        boxes.append((x1, y1, x1 + bw, y1 + bh))
    return img, boxes


def test_classifier_solid_striped_referee_and_other():
    sky, red, yellow, navy, white, purple = (86, 180, 211), (220, 40, 40), (250, 204, 21), (25, 35, 90), (240, 240, 240), (140, 50, 160)
    img, boxes = _frame_with_players([(10, 20, [sky]), (60, 20, [red]), (110, 20, [yellow]),
                                      (160, 20, [navy, white]), (210, 20, [purple])])
    clf = C.TeamColorClassifier.from_match(home="#56b4d3", away="#19235a", referee="#facc15")
    labels = [clf.classify(C.sample_jersey(img, b))[0] for b in boxes]
    assert labels[0] == C.HOME
    assert labels[2] == C.REFEREE
    assert labels[3] == C.AWAY           # 줄무늬 남색 → 원정
    assert labels[4] == C.OTHER          # 관중/코치 색
    # 빨강은 어느 기준과도 멀다
    assert labels[1] == C.OTHER


def test_grass_is_ignored():
    img, boxes = _frame_with_players([(10, 20, [GRASS])])
    s = C.sample_jersey(img, boxes[0])
    # 상체가 전부 잔디색이면 샘플이 없다
    assert s is None


def test_calibrate_snaps_wrong_user_colors_to_observed_clusters():
    rng = np.random.default_rng(1)
    team_a, team_b = (200, 30, 30), (30, 60, 200)
    samples = []
    for i in range(40):
        col = team_a if i % 2 else team_b
        jitter = tuple(int(np.clip(c + rng.normal(0, 8), 0, 255)) for c in col)
        img, boxes = _frame_with_players([(10, 20, [jitter])])
        samples.append(C.sample_jersey(img, boxes[0]))
    # 사용자는 홈=주황, 원정=하늘색이라고 잘못 고름
    clf = C.TeamColorClassifier.from_match(home="#f97316", away="#38bdf8")
    snapped = clf.calibrate(samples)
    assert set(snapped) >= {C.HOME, C.AWAY}
    img, boxes = _frame_with_players([(10, 20, [team_a]), (60, 20, [team_b])])
    assert clf.classify(C.sample_jersey(img, boxes[0]))[0] == C.HOME   # 빨강 ≈ 주황
    assert clf.classify(C.sample_jersey(img, boxes[1]))[0] == C.AWAY   # 파랑 ≈ 하늘


def test_vote_prefers_team_over_noise():
    votes = [(C.HOME, 0.8)] * 6 + [(C.OTHER, 0.0)] * 4 + [(C.AWAY, 0.3)]
    assert C.vote_track_labels(votes)[0] == C.HOME
    assert C.vote_track_labels([(C.OTHER, 0)] * 5)[0] == C.OTHER


def test_lab_roundtrip():
    rgb = np.array([[12, 200, 77], [255, 255, 255], [0, 0, 0]])
    back = C.lab_to_rgb(C.rgb_to_lab(rgb))
    assert np.allclose(back, rgb, atol=1.0)


def test_tracker_keeps_ids_through_crossing_and_misses():
    tr = IoUTracker(min_hits=1)
    ids_a, ids_b = set(), set()
    for f in range(30):
        ax = 10 + f * 6
        bx = 190 - f * 6
        dets = [Detection((ax, 50, ax + 20, 100), 0.9, "a")]
        if f % 7 != 3:  # B를 가끔 놓침
            dets.append(Detection((bx, 52, bx + 20, 102), 0.9, "b"))
        for tid, det in tr.update(f, dets):
            (ids_a if det.payload == "a" else ids_b).add(tid)
    # 교차 지점에서 ID 하나 정도는 바뀔 수 있지만 대부분 유지
    assert len(ids_a) <= 2 and len(ids_b) <= 2
    total_points = sum(len(v) for v in tr.history.values())
    assert total_points >= 55


def test_tracker_low_conf_second_stage():
    tr = IoUTracker(min_hits=1)
    tr.update(0, [Detection((0, 0, 20, 50), 0.9)])
    out = tr.update(1, [Detection((2, 0, 22, 50), 0.2)])  # 가려져 신뢰도 낮음
    assert len(out) == 1 and out[0][0] == 1


def test_stitch_joins_same_player_and_rejects_impossible():
    a = Tracklet("a", "home", [(0, 10, 10), (5, 20, 10)])
    b = Tracklet("b", "home", [(7, 26, 11), (12, 30, 12)])      # 2초에 6m → 가능
    c = Tracklet("c", "home", [(6, 90, 50), (9, 92, 50)])       # 1초에 70m → 불가
    d = Tracklet("d", "away", [(6, 21, 10), (9, 22, 10)])       # 다른 팀
    m = stitch_tracklets([a, b, c, d])
    assert m["b"] == "a"
    assert m["c"] == "c" and m["d"] == "d"


def test_ball_selection_rejects_far_false_positive_and_spike():
    times = [i * 0.2 for i in range(10)]
    cands = []
    for i, t in enumerate(times):
        real = (100 + i * 20, 200, 0.6)
        frame = [real]
        if i == 4:
            frame = [(900, 50, 0.9)]          # 관중석 공(실제 공은 가림)
        if i == 6:
            frame.append((800, 600, 0.95))    # 더 높은 신뢰도의 엉뚱한 후보
        cands.append(frame)
    pos = select_ball_positions(cands, times, frame_w=1280)
    assert pos[4] is None
    assert pos[6] == (220, 200)
    filled = interpolate_gaps(pos, times)
    assert filled[4] == pytest.approx((180, 200))


def test_homography_maps_corners():
    img = [[0.1, 0.2], [0.9, 0.2], [1.0, 0.9], [0.0, 0.9]]
    cal = calibration_from_preset("full", img, 105, 68)
    h = homography(cal["image_points"], cal["pitch_points"])
    out = apply_h(h, np.array(img))
    assert np.allclose(out, cal["pitch_points"], atol=1e-6)
    with pytest.raises(ValueError):
        homography([[0, 0], [1, 1], [2, 2], [3, 3]], [[0, 0], [1, 0], [1, 1], [0, 1]])


def test_mapper_uncalibrated_scale_uses_person_height():
    m = PitchMapper.build(1050, 680, "soccer")
    # 박스 높이 175px → 1px = 1cm. 경기장 좌표 1단위 = 10px → 0.1m
    x, y, r, s = m.player_geometry((500, 300, 540, 475))
    assert (x, y) == pytest.approx((52.0, 47.5))
    assert s == pytest.approx(0.1)
    assert r == pytest.approx(POSSESSION_RADIUS_H * 175 / 10)


def test_mapper_calibrated():
    cal = calibration_from_preset("left_half", [[0, 0], [1, 0], [1, 1], [0, 1]], 100, 60)
    m = PitchMapper.build(1000, 500, "soccer", cal)
    assert m.calibrated
    x, y, r, s = m.player_geometry((480, 200, 520, 250))
    assert (x, y) == pytest.approx((25.0, 30.0))
    assert s == 1.0


def test_tracker_does_not_swap_teams_when_crossing():
    team_of = lambda pl: (pl, 0.9)
    tr = IoUTracker(min_hits=1, team_of=team_of)
    owners = {}
    for f in range(30):
        ax = 10 + f * 6       # 홈 선수 → 오른쪽
        bx = 190 - f * 6      # 원정 선수 ← 왼쪽, 같은 높이로 겹쳐 지나감
        dets = [Detection((ax, 50, ax + 20, 100), 0.9, "home"), Detection((bx, 50, bx + 20, 100), 0.9, "away")]
        for tid, det in tr.update(f, dets):
            owners.setdefault(tid, set()).add(det.payload)
    assert all(len(v) == 1 for v in owners.values())


def test_ball_gap_follows_camera_pan():
    # 공이 0초(0,0)에서 보이다 사라진 동안 카메라가 오른쪽으로 600px 돌고, 4초 뒤 (800,0)에서 다시 보인다.
    times = [i * 0.5 for i in range(9)]
    pos = [(0.0, 0.0)] + [None] * 7 + [(800.0, 0.0)]
    cams = [(75.0 * i * i / 8, 0.0) for i in range(9)]   # 처음엔 천천히, 나중에 빠르게 돈다
    plain = interpolate_gaps(pos, times, max_gap_s=2.5, max_speed_px_s=0.6 * 1000)
    assert plain[4] is None   # 카메라 정보가 없으면 4초·빠른 이동은 잇지 않는다
    out = interpolate_gaps(pos, times, max_gap_s=2.5, max_speed_px_s=0.6 * 1000,
                           cam_centers=cams, cam_min_shift_px=50)
    assert all(p is not None for p in out)
    # 직선 보간(400)보다 카메라를 따라 뒤처진 위치 (화면이 초반엔 천천히 움직였으므로)
    assert out[4][0] < 400
    # 카메라가 거의 안 움직였으면 긴 공백은 그대로 비워 둔다
    still = interpolate_gaps(pos, times, max_gap_s=2.5, max_speed_px_s=0.6 * 1000,
                             cam_centers=[(0.0, 0.0)] * 9, cam_min_shift_px=50)
    assert still[4] is None


def test_body_appearance_separates_teammates():
    frame = np.zeros((200, 200, 3), np.uint8)
    frame[:, :] = (40, 140, 40)                # 잔디
    frame[20:120, 20:60] = (230, 230, 230)      # 같은 흰 상의
    frame[20:120, 120:160] = (230, 230, 230)
    frame[0:14, 20:60] = (30, 20, 10)           # A: 검은 머리, 검은 반바지
    frame[56:76, 20:60] = (20, 20, 20)
    frame[0:14, 120:160] = (200, 170, 60)       # B: 노란 머리, 빨간 반바지
    frame[56:76, 120:160] = (200, 30, 30)
    a = C.body_appearance(frame, (20, 0, 60, 100))
    b = C.body_appearance(frame, (120, 0, 160, 100))
    assert C.appearance_distance(a, a) == pytest.approx(0.0)
    assert C.appearance_distance(a, b) > 30


def test_same_player_suggestions_rank_returning_player_first():
    from app.vision.tracker import suggest_same_player
    app_a, app_b = np.array([20, 0, 0] * 3, float), np.array([60, 40, 30] * 3, float)
    t = [
        Tracklet("T1", "home", [(0, 10, 10), (20, 12, 10)]),     # 화면 밖으로 나감, 외형 A
        Tracklet("T2", "home", [(0, 30, 20), (20, 31, 20)]),     # 다른 선수, 외형 B
        Tracklet("T3", "home", [(50, 20, 12), (70, 22, 12)]),    # 30초 뒤 다시 들어옴, 외형 A
        Tracklet("T4", "away", [(50, 20, 12), (70, 22, 12)]),    # 다른 팀은 후보가 아니다
    ]
    apps = {"T1": (app_a, 30), "T2": (app_b, 30), "T3": (app_a + 2, 30), "T4": (app_a, 30)}
    edge = {k: True for k in apps}
    hints = suggest_same_player(t, {k: k for k in apps}, apps, edge, edge, C.appearance_distance)
    assert hints["T3"][0] == "T1" and hints["T1"][0] == "T3"
    assert "T4" not in hints.get("T1", [])
    # 가장자리로 나간 게 아니면 긴 공백은 후보로 두지 않는다
    assert "T3" not in suggest_same_player(t, {k: k for k in apps}, apps, {}, {}, C.appearance_distance)


def _board_frame(rng, text, w=640, h=360):
    import cv2
    f = np.zeros((h, w, 3), np.uint8)
    f[:] = (40, 120 + rng.integers(0, 30), 40)
    # 카메라가 움직이는 배경: 매 장면 다른 위치의 흰 선
    x = int(rng.integers(0, w))
    cv2.line(f, (x, 60), (x + 80, h), (230, 230, 230), 2)
    cv2.rectangle(f, (10, 4), (260, 30), (40, 40, 200), -1)
    size = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2)[0][0]
    cv2.putText(f, text, (135 - size // 2, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2, cv2.LINE_AA)
    return f


def test_scoreboard_reader_counts_goals_from_score_caption():
    from app.vision.scoreboard import ScoreboardReader
    rng = np.random.default_rng(0)
    r = ScoreboardReader(640, 360)
    for t in range(240):
        text = "AA 0 : 0 BB" if t < 70 else ("AA 0 : 1 BB" if t < 160 else "AA 1 : 1 BB")
        frame = _board_frame(rng, text)
        if 100 <= t < 104:
            frame[4:30, 10:260] = (40, 120, 40)      # 자막이 잠깐 사라진 장면 (리플레이 전환)
        r.add(float(t), frame)
    out = r.finish()
    assert out["found"]
    ch = out["changes"]
    assert [c["side"] for c in ch] == ["right", "left"]
    assert abs(ch[0]["t"] - 70) <= 2 and abs(ch[1]["t"] - 160) <= 2


def test_scoreboard_goals_attach_preceding_shot():
    from app.vision.pipeline import scoreboard_goals
    board = {"found": True, "box": [0, 0, 1, 1], "changes": [{"t": 100.0, "side": "right"}, {"t": 300.0, "side": "left"}]}
    events = [{"kind": "shot", "team": "away", "t": 80.0, "player": "P7"},
              {"kind": "shot", "team": "away", "t": 20.0, "player": "P8"},     # 너무 이른 슈팅
              {"kind": "pass", "team": "home", "t": 295.0, "player": "P1"}]
    out = scoreboard_goals(board, events)
    assert out["score"] == {"home": 1, "away": 1}
    assert out["goals"][0]["player"] == "P7" and out["goals"][0]["t"] == 80.0
    assert out["goals"][1]["player"] is None and out["goals"][1]["t"] == 300.0


def test_in_play_candidates_drop_spare_ball_and_lights():
    from app.vision.ball import in_play_candidates
    # 선수 8명이 화면 가운데 (키 40px), 벤치 옆 여분의 공(오른쪽 아래 멀리), 화면 맨 위 조명
    persons = [((400 + 30 * i, 300, 420 + 30 * i, 340), 0.9) for i in range(8)]
    balls = [(500, 345, 0.3), (1200, 700, 0.6), (600, 10, 0.5)]
    assert in_play_candidates(balls, persons, 720) == [(500, 345, 0.3)]
    # 사람이 거의 없으면 조명만 거른다
    assert in_play_candidates(balls, persons[:2], 720) == [(500, 345, 0.3), (1200, 700, 0.6)]
