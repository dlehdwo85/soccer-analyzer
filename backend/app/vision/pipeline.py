"""영상 → 분석 결과 파이프라인.

analyze_video()   : 실제 영상 (YOLO 필요 — requirements-vision.txt)
analyze_simulated(): 가상 경기 (샘플 모드)
둘 다 postprocess()로 같은 결과 형식(version 2)을 만든다.

결과 형식
{
  "version": 2,
  "meta": {...},                 # 길이, fps, 보정 여부, 공격 방향, 검출된 유니폼 색, 경고
  "players": [{track_id, team, label, color_hex, thumbnail, stats}],
  "events": [...],               # possession / pass / shot / recovery
  "team_stats": {...}, "pass_network": {...}, "possession_timeline": [...]
}
선수 stats는 합산 가능한 원시값이다(stats.finalize로 파생 지표 계산).
"""

from __future__ import annotations

import base64
import gzip
import json
import logging
import os
import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional, Protocol, Sequence, Tuple

import numpy as np

from . import color as C
from .ball import interpolate_gaps, select_ball_positions
from .camera import CameraMotion, stationary
from .events import EventConfig, Frame, PlayerObs, detect_events
from .pitch import GOAL_WIDTH, PitchMapper
from .stats import compute_player_stats, pass_network, possession_timeline, team_stats
from .tracker import Detection, IoUTracker, Tracklet, stitch_tracklets

logger = logging.getLogger(__name__)

RESULT_VERSION = 2
MIN_ANALYSIS_FPS = 5.0
ProgressFn = Callable[[float, str], None]


@dataclass
class AnalysisConfig:
    field_type: str = "soccer"
    home_color: str = "#ef4444"
    away_color: str = "#3b82f6"
    referee_color: Optional[str] = "#facc15"
    home_gk_color: Optional[str] = None
    away_gk_color: Optional[str] = None
    calibration: Optional[Dict] = None
    analysis_fps: float = 6.0
    home_attacks: str = "auto"
    halftime_s: Optional[float] = None
    max_seconds: Optional[float] = None
    start_seconds: float = 0.0
    color_calib_s: float = 30.0
    minor_track_s: float = 10.0

    @classmethod
    def from_dict(cls, d: Dict) -> "AnalysisConfig":
        keys = cls.__dataclass_fields__.keys()
        return cls(**{k: v for k, v in (d or {}).items() if k in keys})

    def event_config(self, length: float, width: float) -> EventConfig:
        return EventConfig(length=length, width=width,
                           goal_width=GOAL_WIDTH.get(self.field_type, 7.32),
                           home_attacks=self.home_attacks,
                           # halftime_s는 영상 전체 기준 시각, 이벤트 시각은 분석 시작점 기준
                           halftime_s=(self.halftime_s - self.start_seconds) if self.halftime_s is not None else None)


# ── 검출기 ──────────────────────────────────────────────────────────────────

class Detector(Protocol):
    def detect(self, frame_rgb: np.ndarray) -> Tuple[List[Tuple[Tuple[float, float, float, float], float]],
                                                     List[Tuple[float, float, float]]]:
        """반환: (사람 [(box, conf)], 공 [(cx, cy, conf)])"""


class YoloDetector:
    """ultralytics YOLO (COCO: 0=person, 32=sports ball). 모델·해상도는 환경변수로 조정.

    공은 화면에서 몇 픽셀밖에 안 될 때가 많아 COCO 범용 모델로는 잘 안 잡힌다.
    축구공으로 학습한 YOLO 가중치가 있으면 YOLO_BALL_MODEL로 지정한다(클래스 이름에 ball/football 포함).
    """

    PERSON_CONF = 0.2
    BALL_CONF = 0.05   # 낮게 잡고, 시간 연속성으로 거른다 (ball.select_ball_positions)

    def __init__(self, model: Optional[str] = None, imgsz: Optional[int] = None, device: Optional[str] = None,
                 ball_model: Optional[str] = None):
        try:
            from ultralytics import YOLO
        except ImportError as e:  # pragma: no cover - 환경 의존
            raise RuntimeError("영상 분석에는 ultralytics가 필요합니다: pip install -r requirements-worker.txt") from e
        self.model = YOLO(model or os.environ.get("YOLO_MODEL", "yolov8s.pt"))
        self.imgsz = imgsz or int(os.environ.get("YOLO_IMGSZ", "1280"))
        self.device = device or os.environ.get("YOLO_DEVICE") or None
        bm = ball_model or os.environ.get("YOLO_BALL_MODEL")
        self.ball_model = YOLO(bm) if bm else None
        self.ball_classes = None
        if self.ball_model is not None:
            names = self.ball_model.names
            self.ball_classes = [k for k, v in names.items() if "ball" in str(v).lower()] or list(names)

    def detect(self, frame_rgb):
        classes = [0] if self.ball_model is not None else [0, 32]
        res = self.model.predict(frame_rgb, imgsz=self.imgsz, classes=classes, conf=self.BALL_CONF,
                                 device=self.device, verbose=False)[0]
        persons, balls = [], []
        if res.boxes is not None and len(res.boxes):
            xyxy = res.boxes.xyxy.cpu().numpy()
            conf = res.boxes.conf.cpu().numpy()
            cls = res.boxes.cls.cpu().numpy().astype(int)
            for b, c, k in zip(xyxy, conf, cls):
                if k == 0 and c >= self.PERSON_CONF:
                    persons.append(((float(b[0]), float(b[1]), float(b[2]), float(b[3])), float(c)))
                elif k == 32:
                    balls.append((float((b[0] + b[2]) / 2), float((b[1] + b[3]) / 2), float(c)))
        if self.ball_model is not None:
            rb = self.ball_model.predict(frame_rgb, imgsz=self.imgsz, classes=self.ball_classes, conf=self.BALL_CONF,
                                         device=self.device, verbose=False)[0]
            if rb.boxes is not None and len(rb.boxes):
                for b, c in zip(rb.boxes.xyxy.cpu().numpy(), rb.boxes.conf.cpu().numpy()):
                    balls.append((float((b[0] + b[2]) / 2), float((b[1] + b[3]) / 2), float(c)))
        return persons, balls


# ── 실제 영상 ────────────────────────────────────────────────────────────────

@dataclass
class _TrackInfo:
    votes: List[Tuple[str, float]] = field(default_factory=list)
    labs: List[np.ndarray] = field(default_factory=list)
    best_area: float = 0.0
    thumb: Optional[bytes] = None


def _encode_thumb(frame_rgb: np.ndarray, box) -> Optional[bytes]:
    try:
        import cv2
    except ImportError:  # pragma: no cover
        return None
    h, w = frame_rgb.shape[:2]
    x1, y1, x2, y2 = (int(round(v)) for v in box)
    pad = int(0.1 * (y2 - y1))
    x1, y1, x2, y2 = max(0, x1 - pad), max(0, y1 - pad), min(w, x2 + pad), min(h, y2 + pad)
    if x2 - x1 < 4 or y2 - y1 < 8:
        return None
    crop = cv2.cvtColor(frame_rgb[y1:y2, x1:x2], cv2.COLOR_RGB2BGR)
    scale = 128 / crop.shape[0]
    crop = cv2.resize(crop, (max(1, int(crop.shape[1] * scale)), 128))
    ok, buf = cv2.imencode(".jpg", crop, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
    return buf.tobytes() if ok else None


def analyze_video(source: str, cfg: AnalysisConfig, detector: Optional[Detector] = None,
                  progress: Optional[ProgressFn] = None) -> Dict:
    import cv2

    progress = progress or (lambda p, m: None)
    cap = cv2.VideoCapture(source)
    if not cap.isOpened():
        raise RuntimeError(f"영상을 열 수 없습니다: {source}")
    fps_video = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    frame_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    frame_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    a_fps = max(MIN_ANALYSIS_FPS, min(cfg.analysis_fps, fps_video))
    stride = max(1, int(round(fps_video / a_fps)))
    eff_fps = fps_video / stride
    start_f = int(cfg.start_seconds * fps_video)
    end_f = total if not cfg.max_seconds else min(total or 10 ** 9, start_f + int(cfg.max_seconds * fps_video))
    if start_f:
        cap.set(cv2.CAP_PROP_POS_FRAMES, start_f)

    mapper = PitchMapper.build(frame_w, frame_h, cfg.field_type, cfg.calibration)
    # 보정이 없으면 카메라가 움직인다고 보고 화면 이동을 보정한다 (보정된 고정 카메라는 그대로)
    cam = None if mapper.calibrated else CameraMotion(frame_w, frame_h)
    clf = C.TeamColorClassifier.from_match(cfg.home_color, cfg.away_color, cfg.referee_color,
                                           cfg.home_gk_color, cfg.away_gk_color)
    detector = detector or YoloDetector()
    tracker = IoUTracker(team_of=lambda pl: (C.TEAM_OF_LABEL.get(pl[0]), pl[1]) if pl else (None, 0.0))
    info: Dict[int, _TrackInfo] = defaultdict(_TrackInfo)
    times: List[float] = []
    ball_cands: List[List[Tuple[float, float, float]]] = []
    warnings: List[str] = []
    rng = np.random.default_rng(0)

    # 색 보정 전까지 검출(프레임 이미지는 제외 — 메모리)을 모아 두었다가 보정 후 한꺼번에 분류
    buffered: List[Tuple[int, List]] = []
    calibrated_colors = False
    calib_frames = max(10, int(cfg.color_calib_s * eff_fps))
    removed_outside = 0

    def run_tracker(k: int, frame_rgb: Optional[np.ndarray], dets: List):
        tracked = []
        for box, conf, sample, orig in dets:
            label, lconf = clf.classify(sample)
            tracked.append(Detection(box, conf, (label, lconf, sample.median_lab if sample else None, orig)))
        for tid, det in tracker.update(k, tracked):
            ti = info[tid]
            ti.votes.append((det.payload[0], det.payload[1]))
            if det.payload[2] is not None:
                ti.labs.append(det.payload[2])
            ob = det.payload[3]
            area = (ob[2] - ob[0]) * (ob[3] - ob[1])
            if frame_rgb is not None and area > ti.best_area and det.payload[0] in C.TEAM_OF_LABEL:
                thumb = _encode_thumb(frame_rgb, ob)
                if thumb:
                    ti.best_area, ti.thumb = area, thumb

    k = 0
    f_idx = start_f
    t_started = time.time()
    while True:
        if end_f and f_idx >= end_f:
            break
        ok = cap.grab()
        if not ok:
            break
        if (f_idx - start_f) % stride:
            f_idx += 1
            continue
        ok, bgr = cap.retrieve()
        if not ok:
            break
        frame_rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        t = (f_idx - start_f) / fps_video
        persons, balls = detector.detect(frame_rgb)
        if cam is not None:
            cam.update(frame_rgb, [b for b, _ in persons])
            balls = [(*cam.point(bx, by), bc) for bx, by, bc in balls]
        dets = []
        for box, conf in persons:
            if mapper.calibrated:
                x, y, _, _ = mapper.player_geometry(box)
                if not mapper.inside(x, y):
                    removed_outside += 1
                    continue  # 관중·벤치
            ref = cam.box(box) if cam is not None else box
            dets.append((ref, conf, C.sample_jersey(frame_rgb, box, rng=rng), box))
        times.append(t)
        ball_cands.append(balls)

        if not calibrated_colors:
            buffered.append((k, dets))
            if len(buffered) >= calib_frames:
                clf.calibrate([d[2] for _, ds in buffered for d in ds if d[2] is not None])
                calibrated_colors = True
                for bk, bdets in buffered:
                    run_tracker(bk, None, bdets)
                buffered = []
        else:
            run_tracker(k, frame_rgb, dets)

        k += 1
        f_idx += 1
        if k % 25 == 0:
            span = (end_f - start_f) if end_f else 0
            pct = min(95.0, (f_idx - start_f) / span * 90) if span else 50.0
            progress(pct, f"선수·공 검출 중 {int(t // 60)}분 {int(t % 60)}초 지점")
    cap.release()

    if not calibrated_colors:
        clf.calibrate([d[2] for _, ds in buffered for d in ds if d[2] is not None])
        for bk, bdets in buffered:
            run_tracker(bk, None, bdets)
    if not times:
        raise RuntimeError("영상에서 프레임을 읽지 못했습니다")
    logger.info("검출 완료: %d프레임, %.0f초 소요", len(times), time.time() - t_started)
    progress(92, "선수 궤적 정리 및 이벤트 판정 중")

    # ── 트랙 → 팀 확정, 경기장 좌표 ───────────────────────────────────────────
    tracklets: List[Tracklet] = []
    labels: Dict[str, str] = {}
    geo: Dict[str, List[Tuple[int, float, float, float, float]]] = {}
    removed_static = 0
    for tid, pts in tracker.history.items():
        lbl, _ = C.vote_track_labels(info[tid].votes)
        if lbl not in C.TEAM_OF_LABEL:
            continue
        if cam is not None and lbl in (C.HOME, C.AWAY) and stationary(
                [(times[p.frame], (p.box[0] + p.box[2]) / 2, p.box[3]) for p in pts],
                [p.box[3] - p.box[1] for p in pts]):
            removed_static += 1
            continue  # 오래 제자리에 있는 사람 — 관중·벤치
        key = f"T{tid}"
        labels[key] = lbl
        g = []
        for p in pts:
            x, y, r, s = mapper.player_geometry(p.box)
            g.append((p.frame, x, y, r, s))
        geo[key] = g
        lab = np.median(np.array(info[tid].labs), axis=0) if info[tid].labs else None
        tracklets.append(Tracklet(key, C.TEAM_OF_LABEL[lbl], [(times[f], x, y) for f, x, y, _, _ in g], lab))

    mapping = stitch_tracklets(tracklets)
    players_obs: Dict[int, List[PlayerObs]] = defaultdict(list)
    merged_labels: Dict[str, str] = {}
    thumbs: Dict[str, Optional[bytes]] = {}
    thumb_area: Dict[str, float] = {}
    color_by_player: Dict[str, List[np.ndarray]] = defaultdict(list)
    for key, g in geo.items():
        pid = "P" + mapping.get(key, key)[1:]
        merged_labels.setdefault(pid, labels[key])
        team = C.TEAM_OF_LABEL[labels[key]]
        for f, x, y, r, s in g:
            players_obs[f].append(PlayerObs(pid, team, x, y, r, s))
        tid = int(key[1:])
        if info[tid].thumb and info[tid].best_area > thumb_area.get(pid, 0):
            thumbs[pid], thumb_area[pid] = info[tid].thumb, info[tid].best_area
        color_by_player[pid].extend(info[tid].labs[:50])

    ball_px = interpolate_gaps(select_ball_positions(ball_cands, times, frame_w), times)
    frames = []
    for i, t in enumerate(times):
        b = ball_px[i]
        bp = mapper.to_pitch(*b) if b is not None else None
        frames.append(Frame(t, players_obs.get(i, []), bp))

    ball_seen = sum(1 for b in ball_px if b is not None) / len(times)
    if ball_seen < 0.3:
        warnings.append(f"공이 영상의 {ball_seen * 100:.0f}% 구간에서만 검출되어 볼 이벤트가 적게 잡혔을 수 있습니다.")
    camera_moving = cam is not None and cam.travel() > 0.3 * frame_w
    if camera_moving:
        warnings.append("카메라가 움직이는 영상입니다. 화면 이동을 보정해 추적했지만 공격 방향·슈팅 위치 판정은 "
                        "부정확할 수 있으니 '이벤트 검수'에서 슈팅을 확인해 주세요.")
    elif not mapper.calibrated:
        warnings.append("경기장 지정이 없어 경기장 밖 사람(벤치·관중)이 일부 섞일 수 있습니다. '선수 정리'에서 제외하세요.")
    if len(tracker.history) and not labels:
        warnings.append("유니폼 색으로 팀을 구분하지 못했습니다. 경기 설정의 팀 색상을 확인하세요.")

    meta = {
        "source": "video",
        "start_s": cfg.start_seconds,
        "duration_s": round(times[-1], 1),
        "fps_video": round(fps_video, 2),
        "analysis_fps": round(eff_fps, 2),
        "frame_w": frame_w, "frame_h": frame_h,
        "calibrated": mapper.calibrated,
        "ball_detected_pct": round(ball_seen * 100, 1),
        "raw_tracks": len(tracker.history),
        "removed_outside_pitch": removed_outside,
        "removed_static": removed_static,
        "camera_moving": camera_moving,
        "snapped_colors": dict(clf.snapped_hex),
        "warnings": warnings,
    }
    colors = {pid: C.rgb_to_hex(C.lab_to_rgb(np.median(np.array(v), axis=0))[0])
              for pid, v in color_by_player.items() if v}
    return postprocess(frames, cfg, mapper.length, mapper.width, meta, merged_labels, thumbs, colors, progress)


# ── 가상 경기 (샘플) ─────────────────────────────────────────────────────────

def analyze_simulated(cfg: AnalysisConfig, duration_s: float = 1200.0, seed: int = 7,
                      players_per_team: Optional[int] = None, progress: Optional[ProgressFn] = None) -> Dict:
    from .simulate import simulate_match
    n = players_per_team or (5 if cfg.field_type == "futsal" else 11)
    sim = simulate_match(duration_s=duration_s, fps=5.0, players_per_team=n,
                         field_type=cfg.field_type, seed=seed)
    labels = {}
    for f in sim.frames[:1]:
        for p in f.players:
            gk = p.tid.endswith("1") and len(p.tid) == 2
            labels[p.tid] = (C.HOME_GK if p.team == "home" else C.AWAY_GK) if gk else p.team
    meta = {"source": "sample", "duration_s": duration_s, "fps_video": sim.fps, "analysis_fps": sim.fps,
            "calibrated": True, "ball_detected_pct": None, "raw_tracks": len(labels), "warnings": []}
    colors = {tid: (cfg.home_color if p_team == "home" else cfg.away_color)
              for tid, p_team in ((p.tid, p.team) for p in sim.frames[0].players)}
    return postprocess(sim.frames, cfg, sim.length, sim.width, meta, labels, {}, colors, progress)


# ── 공통 후처리 ──────────────────────────────────────────────────────────────

def postprocess(frames: Sequence[Frame], cfg: AnalysisConfig, length: float, width: float, meta: Dict,
                labels: Dict[str, str], thumbs: Dict[str, Optional[bytes]], colors: Dict[str, str],
                progress: Optional[ProgressFn] = None) -> Dict:
    progress = progress or (lambda p, m: None)
    ecfg = cfg.event_config(length, width)
    events, spells, dirs = detect_events(frames, ecfg)
    ps = compute_player_stats(frames, events, length, width)
    progress(97, "통계 집계 중")
    duration = meta.get("duration_s") or (frames[-1].t if frames else 0)

    players = []
    for tid, st in sorted(ps.items(), key=lambda kv: (kv[1]["team"], kv[0])):
        st = {k: (round(v, 3) if isinstance(v, float) else v) for k, v in st.items()}
        players.append({
            "track_id": tid,
            "team": st.pop("team"),
            "label": labels.get(tid, ""),
            "color_hex": colors.get(tid),
            "thumbnail": base64.b64encode(thumbs[tid]).decode() if thumbs.get(tid) else None,
            "minor": st["seconds_tracked"] < cfg.minor_track_s and st["touches"] == 0,
            "stats": st,
        })

    meta = dict(meta)
    meta.update({"field": {"type": cfg.field_type, "length": length, "width": width},
                 "attack": dirs, "result_version": RESULT_VERSION})
    return {
        "version": RESULT_VERSION,
        "meta": meta,
        "players": players,
        "events": [e.to_dict() for e in events],
        "team_stats": team_stats(ps, spells),
        "pass_network": pass_network(events, ps),
        "possession_timeline": possession_timeline(spells, duration),
    }


# ── 직렬화 (RunPod 응답 크기 절감) ───────────────────────────────────────────

def pack_result(result: Dict) -> str:
    return base64.b64encode(gzip.compress(json.dumps(result, ensure_ascii=False).encode())).decode()


def unpack_result(packed: str) -> Dict:
    return json.loads(gzip.decompress(base64.b64decode(packed)).decode())
