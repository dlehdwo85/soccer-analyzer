import os, math, logging
from typing import List, Optional
from sqlalchemy.orm import Session

from app.models import Match, PlayerTrackSummary, FrameTracking, MatchAnalytics
from app.services.sample_service import generate_sample_data
from app.services.tracker_service import SimpleTracker, Detection
from app.services.color_service import classify_team_by_color
from app.services.advanced_analysis_service import run_advanced_analysis

logger = logging.getLogger(__name__)

UPLOADS_DIR = os.environ.get("UPLOAD_DIR",
    os.path.join(os.path.dirname(__file__), "..", "..", "uploads"))


def _detect_players_in_frame(frame):
    """YOLO 교체 포인트 — 현재는 빈 리스트 반환 → 샘플 모드."""
    return []


def run_analysis(db: Session, match: Match, use_sample: bool = False):
    match.status = "analyzing"
    db.commit()
    try:
        data = None
        if not use_sample and match.video_filename:
            video_path = os.path.join(UPLOADS_DIR, str(match.id), match.video_filename)
            if os.path.exists(video_path):
                data = _analyze_video(video_path, match)
        if data is None:
            num = 5 if match.field_type == "futsal" else 7
            data = generate_sample_data(
                match.id, match.home_team_color, match.away_team_color,
                match.field_type, num, num)

        # 기존 데이터 삭제
        db.query(PlayerTrackSummary).filter(PlayerTrackSummary.match_id == match.id).delete()
        db.query(FrameTracking).filter(FrameTracking.match_id == match.id).delete()
        db.query(MatchAnalytics).filter(MatchAnalytics.match_id == match.id).delete()
        db.flush()

        # 선수 저장
        player_objs = []
        for p in data["players"]:
            obj = PlayerTrackSummary(**{k: v for k, v in p.items()
                                        if hasattr(PlayerTrackSummary, k)})
            db.add(obj)
            player_objs.append(p)

        # 프레임 저장
        BATCH = 1000
        frames = data["frames"][:10000]
        for i in range(0, len(frames), BATCH):
            db.add_all([FrameTracking(**f) for f in frames[i:i+BATCH]])
            db.flush()

        # 고급 분석
        analytics_data = run_advanced_analysis(
            match_id=match.id,
            home_name=match.home_team_name,
            away_name=match.away_team_name,
            players=player_objs,
            frame_data=frames,
            fps=30.0,
        )
        db.add(MatchAnalytics(**analytics_data))

        match.status = "done"
        db.commit()
        logger.info(f"분석 완료: match {match.id}")

    except Exception as e:
        logger.error(f"분석 실패: {e}")
        match.status = "failed"
        db.commit()
        raise


def _analyze_video(video_path: str, match: Match):
    try:
        import cv2
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            return None
        fps = cap.get(cv2.CAP_PROP_FPS) or 30
        sample_n = max(1, int(fps // 5))
        tracker = SimpleTracker()
        frame_idx, all_frames = 0, []
        while True:
            ret, frame = cap.read()
            if not ret:
                break
            if frame_idx % sample_n == 0:
                h, w = frame.shape[:2]
                bboxes = _detect_players_in_frame(frame)
                dets = []
                for bx, by, bw, bh in bboxes:
                    cx, cy = bx + bw/2, by + bh/2
                    px, py = max(0, min(int(cx*w), w-1)), max(0, min(int(cy*h), h-1))
                    b, g, r = frame[py, px]
                    side = classify_team_by_color(f"#{r:02x}{g:02x}{b:02x}",
                                                  match.home_team_color, match.away_team_color)
                    dets.append(Detection(cx, cy, side))
                results = tracker.update(dets)
                ts_ms = int((frame_idx / fps) * 1000)
                for tid, det in results:
                    all_frames.append({
                        "match_id": match.id, "frame_index": frame_idx,
                        "timestamp_ms": ts_ms, "track_id": tid,
                        "team_side": det.team_side,
                        "x": round(det.x, 4), "y": round(det.y, 4),
                        "bbox_x": 0., "bbox_y": 0., "bbox_w": 0., "bbox_h": 0.,
                    })
            frame_idx += 1
        cap.release()
        if not all_frames:
            return None
        from collections import defaultdict
        track_map = defaultdict(list)
        for f in all_frames:
            track_map[f["track_id"]].append(f)
        players = []
        half_ts = max(f["timestamp_ms"] for f in all_frames) / 2
        for tid, flist in track_map.items():
            team = flist[0]["team_side"]
            pos = [(f["x"], f["y"]) for f in flist]
            def sdist(seg):
                d=0.
                for i in range(1,len(seg)):
                    dx=(seg[i][0]-seg[i-1][0])*105; dy=(seg[i][1]-seg[i-1][1])*68
                    d+=math.sqrt(dx*dx+dy*dy)
                return d
            total_m=sdist(pos)
            first_p=[(f["x"],f["y"]) for f in flist if f["timestamp_ms"]<half_ts]
            second_p=[(f["x"],f["y"]) for f in flist if f["timestamp_ms"]>=half_ts]
            ax=sum(p[0] for p in pos)/len(pos); ay=sum(p[1] for p in pos)/len(pos)
            players.append({
                "match_id": match.id, "track_id": tid, "team_side": team,
                "total_distance_m": round(total_m,2),
                "avg_position_x": round(ax,4), "avg_position_y": round(ay,4),
                "active_area_score": 50., "first_half_distance_m": round(sdist(first_p),2),
                "second_half_distance_m": round(sdist(second_p),2),
                "comment": "", "style_badge": "",
                "fatigue_index": 0., "press_count": 0,
                "zone_left_pct": 33., "zone_center_pct": 34., "zone_right_pct": 33.,
                "role_type": "", "sprint_count": 0,
            })
        return {"players": players, "frames": all_frames}
    except Exception as e:
        logger.error(f"영상 분석 오류: {e}")
        return None
