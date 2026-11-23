"""공 양방향 추적과 긴 공백 대략 위치(오버레이 표시 2) 확인."""
import numpy as np

from app.vision.ball import drop_weak_at_feet, interpolate_gaps, select_ball_positions, select_ball_positions_bidir
from app.vision.pipeline import build_overlay

W = 1920.0


def _scene():
    """공이 오른쪽으로 굴러간다. 앞 10장면은 약한 후보(0.1)만, 뒤 10장면은 강한 후보(0.6)."""
    times = [i / 15 for i in range(20)]
    cands = []
    for i in range(20):
        x = 500 + 10 * i
        cands.append([(x, 400.0, 0.1 if i < 10 else 0.6)])
    return times, cands


def test_backward_pass_recovers_weak_candidates_before_reacquire():
    times, cands = _scene()
    fwd = select_ball_positions(cands, times, W, min_conf_new=0.25, memory_s=1.5)
    both = select_ball_positions_bidir(cands, times, W, min_conf_new=0.25, memory_s=1.5)
    assert sum(p is not None for p in fwd) == 10          # 앞으로만: 강한 후보가 나온 뒤부터
    assert sum(p is not None for p in both) == 20         # 뒤로 거슬러 올라가며 약한 후보도 받는다
    assert both[0] == (500, 400.0)


def test_backward_pass_does_not_start_on_weak_candidates_alone():
    times = [i / 15 for i in range(20)]
    cands = [[(500.0 + 10 * i, 400.0, 0.1)] for i in range(20)]
    assert all(p is None for p in select_ball_positions_bidir(cands, times, W, min_conf_new=0.25, memory_s=1.5))


def test_weak_candidate_at_feet_is_dropped_strong_kept():
    persons = [((100.0, 100.0, 140.0, 200.0), 0.9)]          # 발 자리: y 180~210
    balls = [(120.0, 195.0, 0.1), (120.0, 195.0, 0.5), (300.0, 195.0, 0.1)]
    assert drop_weak_at_feet(balls, persons) == [(120.0, 195.0, 0.5), (300.0, 195.0, 0.1)]


def test_overlay_marks_long_gap_estimate_as_rough():
    n = 6
    sel = [(100.0, 100.0), None, None, None, None, (200.0, 100.0)]
    px = list(sel)                       # 짧은 공백 이음 없음
    est = interpolate_gaps(px, [i * 2.0 for i in range(n)], max_gap_s=20)
    ov = build_overlay({}, {}, sel, px, [np.eye(3)] * n, 1920, 1080, 0.0, 2.0, n, ball_est=est)
    flags = {row[0]: row[3] for row in ov["ball"]}
    assert flags[0] == 1 and flags[5] == 1
    assert all(flags[k] == 2 for k in range(1, 5))
