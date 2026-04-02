"""
분석 오케스트레이터
===================
샘플 모드 / 실제 영상 모드 두 가지를 지원.
실제 영상 분석 실패 시 샘플 모드로 graceful fallback.

YOLO 교체 포인트:
  _detect_players_in_frame() 함수를 실제 YOLO 추론으로 교체하면 됩니다.
"""

import os
import math
import logging
from typing import List, Tuple, Optional

from sqlalchemy.orm import Session

from app.models import Match, PlayerTrackSummary, FrameTracking
from app.services.sample_service import generate_sample_data
from app.services.tracker_service import SimpleTracker, Detection
from app.services.color_service import classify_team_by_color

logger = logging.getLogger(__name__)

UPLOADS_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "uploads")


# ── YOLO 교체 포인트 ────────────────────────────────────────────────────────
def _detect_players_in_frame(frame) -> List[Tuple[float, float, float, float]]:
    """
    프레임에서 선수 bounding box 검출.
    Returns: [(x_norm, y_norm, w_norm, h_norm), ...]

    실제 구현 예:
        from ultralytics import YOLO
        model = YOLO("yolov8n.pt")
        results = model(frame, conf=0.5)
        return [(r.boxes.xywhn[0].tolist()) for r in results]
    """
    return []   # MVP에서는 빈 리스트 반환 → 샘플 모드로 자동 전환


# ── 실제 영상 분석 (baseline) ──────────────────────────────────────────────
def _analyze_video(
    video_path: str,
    home_color: str,
    away_color: str,
    match_id: int,
) -> Optional[dict]:
    """
    OpenCV로 영상 프레임을 추출하고 SimpleTracker로 추적.
    YOLO 미연결 상태에서는 None 반환 → 샘플 모드 fallback.
    """
    try:
        import cv2
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            logger.warning(f"Cannot open video: {video_path}")
            return None

        fps      = cap.get(cv2.CAP_PROP_FPS) or 30
        sample_n = max(1, int(fps // 5))    # 5fps로 샘플링
        tracker  = SimpleTracker()

        frame_idx = 0
        all_frames = []

        while True:
            ret, frame = cap.read()
            if not ret:
                break
            if frame_idx % sample_n != 0:
                frame_idx += 1
                continue

            h, w = frame.shape[:2]
            bboxes = _detect_players_in_frame(frame)

            if not bboxes:
                frame_idx += 1
                continue

            dets = []
            for (bx, by, bw, bh) in bboxes:
                cx = bx + bw / 2
                cy = by + bh / 2
                # 선수 중심 픽셀 색상 샘플링
                px = int(cx * w)
                py = int(cy * h)
                px = max(0, min(px, w - 1))
                py = max(0, min(py, h - 1))
                b, g, r = frame[py, px]
                pixel_hex = f"#{r:02x}{g:02x}{b:02x}"
                side = classify_team_by_color(pixel_hex, home_color, away_color)
                dets.append(Detection(cx, cy, side))

            results = tracker.update(dets)
            ts_ms = int((frame_idx / fps) * 1000)

            for tid, det in results:
                all_frames.append({
                    "match_id":    match_id,
                    "frame_index": frame_idx,
                    "timestamp_ms": ts_ms,
                    "track_id":    tid,
                    "team_side":   det.team_side,
                    "x":           round(det.x, 4),
                    "y":           round(det.y, 4),
                    "bbox_x":      0.0, "bbox_y": 0.0, "bbox_w": 0.0, "bbox_h": 0.0,
                })
            frame_idx += 1

        cap.release()

        if not all_frames:
            logger.warning("No frames detected — falling back to sample")
            return None

        # 트랙별 집계
        from collections import defaultdict
        track_map = defaultdict(list)
        for f in all_frames:
            track_map[f["track_id"]].append((f["x"], f["y"], f["team_side"], f["timestamp_ms"]))

        players = []
        total_frames = max(f["frame_index"] for f in all_frames)
        half_ts = (total_frames / fps * 1000) / 2

        for tid, pts in track_map.items():
            xs = [p[0] for p in pts]
            ys = [p[1] for p in pts]
            team = pts[0][2]
            positions = [(p[0], p[1]) for p in pts]

            total_m = 0.0
            for i in range(1, len(positions)):
                dx = (positions[i][0] - positions[i-1][0]) * 105
                dy = (positions[i][1] - positions[i-1][1]) * 68
                total_m += math.sqrt(dx*dx + dy*dy)

            first_pts  = [(p[0],p[1]) for p in pts if p[3] < half_ts]
            second_pts = [(p[0],p[1]) for p in pts if p[3] >= half_ts]

            def seg_dist(seg):
                d = 0.0
                for i in range(1, len(seg)):
                    dx = (seg[i][0]-seg[i-1][0])*105
                    dy = (seg[i][1]-seg[i-1][1])*68
                    d += math.sqrt(dx*dx+dy*dy)
                return d

            d1 = seg_dist(first_pts)
            d2 = seg_dist(second_pts)
            avg_x = sum(xs)/len(xs)
            avg_y = sum(ys)/len(ys)
            spread = (max(xs)-min(xs))*105 + (max(ys)-min(ys))*68
            active = min(spread * 1.2, 100.0)

            players.append({
                "match_id": match_id, "track_id": tid, "team_side": team,
                "total_distance_m": round(total_m, 2),
                "avg_position_x": round(avg_x, 4), "avg_position_y": round(avg_y, 4),
                "active_area_score": round(active, 1),
                "first_half_distance_m": round(d1, 2),
                "second_half_distance_m": round(d2, 2),
                "comment": "", "style_badge": "",
            })

        return {"players": players, "frames": all_frames}

    except Exception as e:
        logger.error(f"Video analysis error: {e}")
        return None


# ── 메인 분석 실행 ──────────────────────────────────────────────────────────
def run_analysis(db: Session, match: Match, use_sample: bool = False):
    """
    분석 실행 진입점.
    1. use_sample=True 또는 영상 없음 → 샘플 데이터 사용
    2. 영상 있음 → 실제 분석 시도 → 실패 시 샘플 fallback
    """
    match.status = "analyzing"
    db.commit()

    try:
        data = None

        # 실제 영상 분석 시도
        if not use_sample and match.video_filename:
            video_path = os.path.join(UPLOADS_DIR, str(match.id), match.video_filename)
            if os.path.exists(video_path):
                logger.info(f"Analyzing video: {video_path}")
                data = _analyze_video(video_path, match.home_team_color, match.away_team_color, match.id)
            else:
                logger.warning(f"Video file not found: {video_path}, using sample")

        # 샘플 또는 fallback
        if data is None:
            logger.info(f"Using sample data for match {match.id}")
            num = 5 if match.field_type == "futsal" else 7
            data = generate_sample_data(match.id, match.home_team_color, match.away_team_color, match.field_type, num, num)

        # 기존 데이터 삭제 후 저장
        db.query(PlayerTrackSummary).filter(PlayerTrackSummary.match_id == match.id).delete()
        db.query(FrameTracking).filter(FrameTracking.match_id == match.id).delete()
        db.flush()

        # PlayerSummary 저장
        from app.services.sample_service import _generate_comment, _generate_style_badge
        player_objs = []
        for p in data["players"]:
            if not p.get("comment"):
                p["comment"] = _generate_comment(
                    p["total_distance_m"], p["avg_position_x"], p["avg_position_y"],
                    p["second_half_distance_m"] / p["first_half_distance_m"]
                    if p["first_half_distance_m"] > 0 else 1.0,
                    p["active_area_score"],
                )
            if not p.get("style_badge"):
                p["style_badge"] = _generate_style_badge(
                    p["avg_position_x"], p["avg_position_y"],
                    p["total_distance_m"], p["active_area_score"],
                )
            obj = PlayerTrackSummary(**p)
            db.add(obj)
            player_objs.append(obj)

        # FrameTracking 배치 저장 (최대 10,000개)
        BATCH = 1000
        frames = data["frames"][:10000]
        for i in range(0, len(frames), BATCH):
            db.add_all([FrameTracking(**f) for f in frames[i:i+BATCH]])
            db.flush()

        match.status = "done"
        db.commit()
        logger.info(f"Analysis done: match {match.id}, {len(player_objs)} players")

    except Exception as e:
        logger.error(f"Analysis failed for match {match.id}: {e}")
        match.status = "failed"
        db.commit()
        raise
