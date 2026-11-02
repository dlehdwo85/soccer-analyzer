"""실제 영상 파일로 파이프라인 전체를 검증한다 (YOLO 대신 색 덩어리 검출기 사용).

가상 경기를 MP4로 렌더링 → 디코딩 → 유니폼 색 분류 → 추적 → 이벤트 판정까지
실제 코드 경로를 그대로 통과시키고, 시뮬레이터 정답과 비교한다.
"""

import os

import numpy as np
import pytest

cv2 = pytest.importorskip("cv2")

from app.vision import color as C  # noqa: E402
from app.vision.pipeline import AnalysisConfig, analyze_video, pack_result, unpack_result  # noqa: E402
from app.vision.simulate import simulate_match  # noqa: E402

PX_PER_M = 10
HOME_RGB, AWAY_RGB, GK_H, GK_A, REF = (86, 180, 211), (220, 38, 38), (250, 140, 20), (30, 30, 30), (250, 230, 30)


def _render(sim, path, fps_video=25):
    L, W = sim.length, sim.width
    w, h = int(L * PX_PER_M), int(W * PX_PER_M)
    out = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"mp4v"), fps_video, (w, h))
    assert out.isOpened()
    per = int(round(fps_video / sim.fps))
    for f in sim.frames:
        img = np.zeros((h, w, 3), np.uint8)
        img[:] = (50, 130, 55)
        img[::40, :] = (70, 150, 70)  # 잔디 줄무늬
        for p in f.players:
            gk = p.tid in ("H1", "A1")
            col = (GK_H if p.team == "home" else GK_A) if gk else (HOME_RGB if p.team == "home" else AWAY_RGB)
            cx, by = int(p.x * PX_PER_M), int(p.y * PX_PER_M)
            x1, x2, y1 = cx - 6, cx + 6, by - 26
            img[max(0, y1):max(0, by - 14), max(0, x1):max(0, x2)] = col                   # 상의
            img[max(0, y1 - 5):max(0, y1), max(0, cx - 3):max(0, cx + 3)] = (230, 190, 160)  # 머리
            img[max(0, by - 14):max(0, by), max(0, x1):max(0, x2)] = (25, 25, 25)            # 하의/다리
        # 심판 1명
        img[200:212, 500:512] = REF
        img[212:226, 500:512] = (20, 20, 20)
        if f.ball is not None:
            cv2.circle(img, (int(f.ball[0] * PX_PER_M), int(f.ball[1] * PX_PER_M)), 4, (255, 255, 255), -1)
        bgr = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
        for _ in range(per):
            out.write(bgr)
    out.release()
    return w, h


class BlobDetector:
    """잔디가 아닌 덩어리를 사람/공으로 검출 (YOLO 대역)."""

    def detect(self, frame_rgb):
        hsv = cv2.cvtColor(frame_rgb, cv2.COLOR_RGB2HSV)
        grass = cv2.inRange(hsv, (35, 60, 60), (85, 255, 255)) > 0
        white = cv2.inRange(frame_rgb, (226, 226, 226), (255, 255, 255)) > 0
        person_mask = (~grass & ~white).astype(np.uint8)
        person_mask = cv2.morphologyEx(person_mask, cv2.MORPH_CLOSE, np.ones((5, 3), np.uint8))
        n, _, st, _ = cv2.connectedComponentsWithStats(person_mask)
        persons = []
        for i in range(1, n):
            x, y, w, h, area = st[i]
            if 60 <= area and 15 <= h <= 80 and w <= 40:
                persons.append(((float(x), float(y), float(x + w), float(y + h)), 0.9))
        n2, _, st2, cen = cv2.connectedComponentsWithStats(white.astype(np.uint8))
        balls = [(float(cen[i][0]), float(cen[i][1]), 0.8) for i in range(1, n2) if 10 <= st2[i][4] <= 80]
        return persons, balls


@pytest.fixture(scope="module")
def rendered(tmp_path_factory):
    sim = simulate_match(duration_s=150, fps=5.0, seed=21)
    path = str(tmp_path_factory.mktemp("vid") / "match.mp4")
    w, h = _render(sim, path)
    return sim, path, w, h


def test_pipeline_end_to_end_on_rendered_video(rendered):
    sim, path, w, h = rendered
    cal = {"image_points": [[0, 0], [1, 0], [1, 1], [0, 1]],
           "pitch_points": [[0, 0], [sim.length, 0], [sim.length, sim.width], [0, sim.width]]}
    cfg = AnalysisConfig(home_color="#3b9fd0", away_color="#d62020", referee_color="#facc15",
                         home_gk_color="#f59e0b", away_gk_color="#222222", calibration=cal,
                         analysis_fps=5.0, color_calib_s=10)
    seen = []
    res = analyze_video(path, cfg, detector=BlobDetector(), progress=lambda p, m: seen.append(p))
    assert res["version"] == 2 and res["meta"]["calibrated"] is True
    assert seen and max(seen) >= 90

    players = res["players"]
    by_team = {"home": [p for p in players if p["team"] == "home" and not p["minor"]],
               "away": [p for p in players if p["team"] == "away" and not p["minor"]]}
    # 22명 + 일부 조각 트랙. 심판은 제외되어야 한다
    assert 8 <= len(by_team["home"]) <= 18 and 8 <= len(by_team["away"]) <= 18
    assert all(p["label"] != C.REFEREE for p in players)
    assert any(p["label"] == C.HOME_GK for p in players) and any(p["label"] == C.AWAY_GK for p in players)
    assert sum(1 for p in players if p["thumbnail"]) >= 15

    # 패스 수가 정답과 비슷해야 한다 (트랙 ID는 달라 개수·성공 여부로 비교)
    truth_pass = [e for e in sim.truth if e.kind == "pass"]
    det_pass = [e for e in res["events"] if e["kind"] == "pass"]
    assert abs(len(det_pass) - len(truth_pass)) <= max(4, 0.25 * len(truth_pass))
    truth_ok = sum(1 for e in truth_pass if e.success)
    det_ok = sum(1 for e in det_pass if e["success"])
    assert abs(det_ok - truth_ok) <= max(4, 0.25 * truth_ok)

    ts = res["team_stats"]
    assert ts["home"]["possession_pct"] is not None
    assert res["possession_timeline"]

    # 직렬화 왕복
    assert unpack_result(pack_result(res))["events"] == res["events"]


def test_pipeline_uncalibrated_and_missing_file(rendered):
    sim, path, w, h = rendered
    cfg = AnalysisConfig(home_color="#3b9fd0", away_color="#d62020", analysis_fps=5.0,
                         color_calib_s=10, max_seconds=40)
    res = analyze_video(path, cfg, detector=BlobDetector())
    assert res["meta"]["calibrated"] is False
    assert any("경기장 지정" in w for w in res["meta"]["warnings"])
    assert res["meta"]["camera_moving"] is False
    assert res["meta"]["duration_s"] <= 41
    with pytest.raises(RuntimeError):
        analyze_video(os.path.join(os.path.dirname(path), "nope.mp4"), cfg, detector=BlobDetector())


def test_detection_cache_replays_without_detector(rendered, tmp_path, monkeypatch):
    sim, path, w, h = rendered
    monkeypatch.setenv("ANALYSIS_CACHE_DIR", str(tmp_path / "cache"))
    cfg = AnalysisConfig(home_color="#3b9fd0", away_color="#d62020", analysis_fps=5.0,
                         color_calib_s=10, max_seconds=30)
    first = analyze_video(path, cfg, detector=BlobDetector())
    files = list((tmp_path / "cache").glob("*.det.pkl"))
    assert len(files) == 1

    class Boom:
        def detect(self, frame_rgb):
            raise AssertionError("캐시가 있으면 검출기를 부르면 안 된다")

    second = analyze_video(path, cfg, detector=Boom())
    assert second["events"] == first["events"]
    assert second["meta"]["ball_detected_pct"] == first["meta"]["ball_detected_pct"]
    assert len(second["players"]) == len(first["players"])
