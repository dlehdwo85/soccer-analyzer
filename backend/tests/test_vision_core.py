import numpy as np
import pytest

from app.vision import color as C
from app.vision.ball import interpolate_gaps, select_ball_positions
from app.vision.pitch import PitchMapper, apply_h, calibration_from_preset, homography
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
    assert r == pytest.approx(0.55 * 175 / 10)


def test_mapper_calibrated():
    cal = calibration_from_preset("left_half", [[0, 0], [1, 0], [1, 1], [0, 1]], 100, 60)
    m = PitchMapper.build(1000, 500, "soccer", cal)
    assert m.calibrated
    x, y, r, s = m.player_geometry((480, 200, 520, 250))
    assert (x, y) == pytest.approx((25.0, 30.0))
    assert s == 1.0
