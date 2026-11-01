import numpy as np
import pytest

cv2 = pytest.importorskip("cv2")

from app.vision.camera import CameraMotion, stationary  # noqa: E402


def _scene(w=1600, h=900, seed=0):
    rng = np.random.default_rng(seed)
    img = rng.integers(0, 255, (h // 8, w // 8, 3), dtype=np.uint8)
    img = cv2.resize(img, (w, h), interpolation=cv2.INTER_CUBIC)
    return cv2.GaussianBlur(img, (5, 5), 0)


def _view(scene, cx, cy, zoom, w=640, h=360):
    """장면에서 (cx, cy) 중심, zoom 배율로 잘라낸 카메라 화면 + 화면 고정 자막."""
    M = np.array([[zoom, 0, w / 2 - zoom * cx], [0, zoom, h / 2 - zoom * cy]], dtype=np.float64)
    frame = cv2.warpAffine(scene, M, (w, h))
    frame[10:40, 200:440] = 255           # 점수판 (카메라와 같이 움직이지 않음)
    cv2.putText(frame, "MMU 0 : 0 ESSEX", (210, 32), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 2)
    return frame, M


def test_camera_motion_recovers_pan_and_zoom_and_ignores_overlay():
    scene = _scene()
    cam = CameraMotion(640, 360)
    path = [(600 + 12 * i, 450 + 2 * i, 1.0 + 0.01 * i) for i in range(30)]  # 오른쪽으로 팬하며 조금씩 줌인
    first_M = None
    for cx, cy, z in path:
        frame, M = _view(scene, cx, cy, z)
        if first_M is None:
            first_M = M
        cam.update(frame, [])
    # 마지막 화면의 한 점(장면 좌표 p)이 기준(첫 화면) 좌표로 정확히 옮겨져야 한다
    p_scene = np.array([900.0, 500.0, 1.0])
    p_last = M @ p_scene
    p_first = first_M @ p_scene
    got = cam.point(*p_last)
    assert got == pytest.approx(tuple(p_first[:2]), abs=1.5)
    assert cam.travel() > 200
    assert cam.failed == 0


def test_camera_motion_static_video_stays_identity():
    scene = _scene(seed=1)
    cam = CameraMotion(640, 360)
    for _ in range(10):
        frame, _ = _view(scene, 800, 450, 1.0)
        cam.update(frame, [])
    assert np.allclose(cam.T, np.eye(3), atol=1e-2)
    assert cam.box((100, 100, 120, 160)) == pytest.approx((100, 100, 120, 160), abs=0.5)


def test_stationary_filter():
    still = [(t * 0.5, 300 + (t % 3), 200.0) for t in range(60)]        # 30초 동안 제자리 (관중)
    moving = [(t * 0.5, 300 + t * 4.0, 200.0) for t in range(60)]       # 계속 이동 (선수)
    short = [(t * 0.5, 300.0, 200.0) for t in range(10)]                # 5초 — 판단 보류
    h = [40.0] * 60
    assert stationary(still, h) is True
    assert stationary(moving, h) is False
    assert stationary(short, h[:10]) is False
