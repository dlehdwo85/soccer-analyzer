"""
분석 오케스트레이터 (RunPod 연동 버전)
========================================
우선순위:
1. RUNPOD_API_KEY + 영상 URL → RunPod GPU 분석
2. 영상 없거나 RunPod 미설정 → 샘플 데이터
"""

import os
import logging
from sqlalchemy.orm import Session

from app.models import Match, PlayerTrackSummary, FrameTracking, MatchAnalytics
from app.services.sample_service import generate_sample_data
from app.services.advanced_analysis_service import run_advanced_analysis

logger = logging.getLogger(__name__)

UPLOADS_DIR = os.environ.get("UPLOAD_DIR",
    os.path.join(os.path.dirname(__file__), "..", "..", "uploads"))

RUNPOD_API_KEY     = os.environ.get("RUNPOD_API_KEY", "")
RUNPOD_ENDPOINT_ID = os.environ.get("RUNPOD_ENDPOINT_ID", "")


def _has_runpod():
    return bool(RUNPOD_API_KEY and RUNPOD_ENDPOINT_ID)


def _save_results(db, match, data):
    """분석 결과를 DB에 저장."""
    db.query(PlayerTrackSummary).filter(PlayerTrackSummary.match_id == match.id).delete()
    db.query(FrameTracking).filter(FrameTracking.match_id == match.id).delete()
    db.query(MatchAnalytics).filter(MatchAnalytics.match_id == match.id).delete()
    db.flush()

    player_objs = []
    for p in data["players"]:
        obj = PlayerTrackSummary(**{k: v for k, v in p.items()
                                    if hasattr(PlayerTrackSummary, k)})
        db.add(obj)
        player_objs.append(p)

    BATCH = 500
    frames = data["frames"][:10000]
    for i in range(0, len(frames), BATCH):
        db.add_all([FrameTracking(**{k: v for k, v in f.items()
                                     if hasattr(FrameTracking, k)})
                    for f in frames[i:i+BATCH]])
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
    return player_objs


def run_analysis(db: Session, match: Match, use_sample: bool = False):
    match.status = "analyzing"
    db.commit()

    try:
        data = None

        # ── RunPod GPU 분석 ──────────────────────────────
        if not use_sample and _has_runpod() and match.video_url:
            try:
                logger.info(f"RunPod 분석 시작: match_id={match.id}")
                from app.services.runpod_service import run_analysis_on_runpod
                result = run_analysis_on_runpod(
                    match_id=match.id,
                    video_url=match.video_url,
                    home_color=match.home_team_color,
                    away_color=match.away_team_color,
                    referee_color=getattr(match, 'referee_color', '#facc15'),
                    field_type=match.field_type,
                )
                data = {
                    "players": result.get("players", []),
                    "frames":  result.get("frames", []),
                }
                logger.info(f"RunPod 분석 완료: {len(data['players'])}명")
            except Exception as e:
                logger.error(f"RunPod 분석 실패, 샘플로 대체: {e}")
                data = None

        # ── 샘플 데이터 (fallback) ───────────────────────
        if data is None:
            logger.info(f"샘플 데이터 사용: match_id={match.id}")
            num = 5 if match.field_type == "futsal" else 7
            data = generate_sample_data(
                match.id, match.home_team_color, match.away_team_color,
                match.field_type, num, num)

        _save_results(db, match, data)
        match.status = "done"
        db.commit()
        logger.info(f"분석 완료: match_id={match.id}")

    except Exception as e:
        logger.error(f"분석 실패: {e}")
        match.status = "failed"
        db.commit()
        raise
