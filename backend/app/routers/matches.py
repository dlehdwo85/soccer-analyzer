import os, logging
from typing import List
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Match, PlayerTrackSummary, FrameTracking, MatchAnalytics, GpsTrackPoint, PlayerProfile
from app.schemas import (
    MatchCreate, MatchOut, AnalyzeRequest, MatchAnalyticsOut, PlayerOut,
    GpsPreviewOut, GpsUploadResult, PlayerProfileOut, PlayerMatchHistoryItem,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/matches", tags=["matches"])

UPLOADS_DIR = os.environ.get("UPLOAD_DIR",
    os.path.join(os.path.dirname(__file__), "..", "..", "uploads"))
MAX_FILE_MB = int(os.environ.get("MAX_UPLOAD_SIZE_MB", "2048"))


@router.get("", response_model=List[MatchOut])
def list_matches(db: Session = Depends(get_db)):
    return db.query(Match).order_by(Match.created_at.desc()).all()


@router.post("", response_model=MatchOut, status_code=201)
def create_match(body: MatchCreate, db: Session = Depends(get_db)):
    match = Match(**body.model_dump())
    db.add(match); db.commit(); db.refresh(match)
    return match


@router.get("/{match_id}", response_model=MatchOut)
def get_match(match_id: int, db: Session = Depends(get_db)):
    m = db.query(Match).filter(Match.id == match_id).first()
    if not m: raise HTTPException(404, "Match not found")
    return m


@router.post("/{match_id}/upload")
async def upload_video(match_id: int, file: UploadFile = File(...), db: Session = Depends(get_db)):
    m = db.query(Match).filter(Match.id == match_id).first()
    if not m: raise HTTPException(404, "Match not found")
    ext = (file.filename or "").split(".")[-1].lower()
    if ext not in ("mp4", "mov"): raise HTTPException(400, "MP4 또는 MOV만 허용")
    content = await file.read()
    size_mb = len(content) / (1024*1024)
    if size_mb > MAX_FILE_MB: raise HTTPException(413, f"최대 {MAX_FILE_MB}MB")

    # Supabase Storage 업로드 시도
    video_url = ""
    try:
        from app.services.storage_service import upload_video as supabase_upload
        video_url = supabase_upload(content, file.filename or "video.mp4", match_id)
    except Exception as e:
        logger.warning(f"Supabase 업로드 실패, 로컬 저장: {e}")

    # 로컬 저장 (fallback)
    if not video_url:
        save_dir = os.path.join(UPLOADS_DIR, str(match_id))
        os.makedirs(save_dir, exist_ok=True)
        with open(os.path.join(save_dir, file.filename or "video.mp4"), "wb") as f:
            f.write(content)

    m.video_filename = file.filename
    m.video_url = video_url or f"local:{match_id}/{file.filename}"
    m.status = "uploaded"
    db.commit()
    return {"filename": file.filename, "size_mb": round(size_mb,2), "message": "업로드 완료", "video_url": video_url}


@router.post("/{match_id}/analyze")
def start_analyze(match_id: int, body: AnalyzeRequest, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    m = db.query(Match).filter(Match.id == match_id).first()
    if not m: raise HTTPException(404, "Match not found")
    if m.status == "analyzing": raise HTTPException(409, "이미 분석 중")

    from app.services.analysis_service import run_analysis
    from app.database import SessionLocal

    def _run():
        _db = SessionLocal()
        try:
            _m = _db.query(Match).filter(Match.id == match_id).first()
            run_analysis(_db, _m, use_sample=body.use_sample)
        finally:
            _db.close()

    background_tasks.add_task(_run)
    m.status = "analyzing"; db.commit()

    # RunPod 사용 여부 안내
    runpod_enabled = bool(os.environ.get("RUNPOD_API_KEY") and os.environ.get("RUNPOD_ENDPOINT_ID"))
    msg = "GPU 분석 서버 시작 중..." if (runpod_enabled and not body.use_sample) else "분석 시작"
    return {"status": "analyzing", "message": msg, "runpod_enabled": runpod_enabled}


@router.get("/{match_id}/summary")
def get_summary(match_id: int, db: Session = Depends(get_db)):
    m = db.query(Match).filter(Match.id == match_id).first()
    if not m: raise HTTPException(404, "Match not found")
    if m.status != "done": raise HTTPException(400, "분석 미완료")

    players   = db.query(PlayerTrackSummary).filter(PlayerTrackSummary.match_id == match_id).all()
    analytics = db.query(MatchAnalytics).filter(MatchAnalytics.match_id == match_id).first()

    home_p = [p for p in players if p.team_side == "home"]
    away_p = [p for p in players if p.team_side == "away"]

    def avg(lst, attr): return round(sum(getattr(p,attr) for p in lst)/len(lst),4) if lst else 0.5

    return {
        "match":             MatchOut.model_validate(m),
        "players":           [PlayerOut.model_validate(p) for p in players],
        "home_avg_x":        avg(home_p, "avg_position_x"),
        "home_avg_y":        avg(home_p, "avg_position_y"),
        "away_avg_x":        avg(away_p, "avg_position_x"),
        "away_avg_y":        avg(away_p, "avg_position_y"),
        "total_distance_km": round(sum(p.total_distance_m for p in players), 2),
        "analytics":         MatchAnalyticsOut.model_validate(analytics) if analytics else None,
    }


@router.get("/{match_id}/players")
def list_players(match_id: int, db: Session = Depends(get_db)):
    players = db.query(PlayerTrackSummary).filter(PlayerTrackSummary.match_id == match_id).all()
    return [PlayerOut.model_validate(p) for p in players]


@router.get("/{match_id}/players/{track_id}")
def get_player_detail(match_id: int, track_id: str, db: Session = Depends(get_db)):
    from app.schemas import FramePointOut
    p = db.query(PlayerTrackSummary).filter(
        PlayerTrackSummary.match_id == match_id,
        PlayerTrackSummary.track_id == track_id).first()
    if not p: raise HTTPException(404, "Player not found")
    frames = db.query(FrameTracking).filter(
        FrameTracking.match_id == match_id,
        FrameTracking.track_id == track_id
    ).order_by(FrameTracking.frame_index).limit(300).all()
    result = PlayerOut.model_validate(p).model_dump()
    result["frames"] = [FramePointOut.model_validate(f).model_dump() for f in frames]
    return result


# ── POST /api/matches/{id}/set-video-url ──────────────────────────────────
from pydantic import BaseModel as PydanticBase

class VideoUrlBody(PydanticBase):
    video_url: str
    filename: str

@router.post("/{match_id}/set-video-url")
def set_video_url(match_id: int, body: VideoUrlBody, db: Session = Depends(get_db)):
    m = db.query(Match).filter(Match.id == match_id).first()
    if not m: raise HTTPException(404, "Match not found")
    m.video_url = body.video_url
    m.video_filename = body.filename
    m.status = "uploaded"
    db.commit()
    return {"message": "영상 URL 저장 완료", "video_url": body.video_url}


# ── GET /api/matches/{id}/upload-url ──────────────────────────────────────
@router.get("/{match_id}/upload-url")
def get_upload_url(match_id: int, filename: str, db: Session = Depends(get_db)):
    """프론트엔드에서 R2에 직접 업로드할 수 있는 Presigned URL 반환."""
    m = db.query(Match).filter(Match.id == match_id).first()
    if not m: raise HTTPException(404, "Match not found")

    from app.services.storage_service import get_presigned_upload_url
    result = get_presigned_upload_url(match_id, filename)

    if not result:
        raise HTTPException(500, "업로드 URL 생성 실패. R2 환경변수를 확인하세요.")

    return result


# ── POST /api/matches/{id}/gps-preview ────────────────────────────────────
@router.post("/{match_id}/gps-preview")
async def gps_preview(
    match_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """GPS 파일을 DB 저장 없이 파싱해서 미리보기 정보만 반환."""
    m = db.query(Match).filter(Match.id == match_id).first()
    if not m: raise HTTPException(404, "Match not found")

    filename = file.filename or "data.csv"
    ext = filename.rsplit(".", 1)[-1].lower()
    if ext not in ("csv", "json", "gpx"):
        raise HTTPException(400, "CSV, JSON, GPX 파일만 지원합니다")

    content = await file.read()
    if len(content) > 50 * 1024 * 1024:  # 50MB 제한
        raise HTTPException(413, "GPS 파일은 50MB 이하만 지원합니다")

    try:
        from app.services.gps_service import get_gps_preview
        preview = get_gps_preview(filename, content)
        return preview
    except ValueError as e:
        raise HTTPException(422, str(e))
    except Exception as e:
        logger.error(f"GPS 미리보기 실패: {e}")
        raise HTTPException(500, f"파일 파싱 실패: {e}")


# ── POST /api/matches/{id}/upload-gps ────────────────────────────────────
@router.post("/{match_id}/upload-gps")
async def upload_gps(
    match_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """
    GPS 파일을 업로드하고 즉시 분석 결과를 생성한다.
    기존 영상 분석과 동일한 players/frames 구조로 저장하므로
    분석 결과 페이지를 그대로 사용할 수 있다.
    """
    m = db.query(Match).filter(Match.id == match_id).first()
    if not m: raise HTTPException(404, "Match not found")
    if m.status == "analyzing": raise HTTPException(409, "이미 분석 중입니다")

    filename = file.filename or "data.csv"
    ext = filename.rsplit(".", 1)[-1].lower()
    if ext not in ("csv", "json", "gpx"):
        raise HTTPException(400, "CSV, JSON, GPX 파일만 지원합니다")

    content = await file.read()
    if len(content) > 50 * 1024 * 1024:
        raise HTTPException(413, "GPS 파일은 50MB 이하만 지원합니다")

    try:
        from app.services.gps_service import process_gps_data
        result = process_gps_data(match_id, filename, content)
    except ValueError as e:
        raise HTTPException(422, str(e))
    except Exception as e:
        logger.error(f"GPS 파싱 실패: {e}")
        raise HTTPException(500, f"파일 파싱 실패: {e}")

    # 기존 분석 데이터 초기화 후 GPS 결과로 교체
    db.query(GpsTrackPoint).filter(GpsTrackPoint.match_id == match_id).delete()
    from app.services.advanced_analysis_service import run_advanced_analysis

    db.query(PlayerTrackSummary).filter(PlayerTrackSummary.match_id == match_id).delete()
    db.query(FrameTracking).filter(FrameTracking.match_id == match_id).delete()
    db.query(MatchAnalytics).filter(MatchAnalytics.match_id == match_id).delete()
    db.flush()

    players_data = result["players"]
    frames_data  = result["frames"]

    for p in players_data:
        # _player_name, _jersey_number 는 내부 전용 필드 제거
        clean = {k: v for k, v in p.items() if not k.startswith("_") and hasattr(PlayerTrackSummary, k)}
        db.add(PlayerTrackSummary(**clean))

    BATCH = 500
    for i in range(0, min(len(frames_data), 10000), BATCH):
        db.add_all([
            FrameTracking(**{k: v for k, v in f.items() if hasattr(FrameTracking, k)})
            for f in frames_data[i:i+BATCH]
        ])
        db.flush()

    analytics_data = run_advanced_analysis(
        match_id=match_id,
        home_name=m.home_team_name,
        away_name=m.away_team_name,
        players=players_data,
        frame_data=frames_data,
        fps=2.0,  # GPS는 보통 0.5~2Hz
    )
    db.add(MatchAnalytics(**analytics_data))

    # 선수 프로필 누적 업데이트
    _update_player_profiles(db, match_id, players_data)

    m.status = "done"
    m.data_source = "gps"
    db.commit()

    preview = result["preview"]
    return {
        "message":       "GPS 분석 완료",
        "total_points":  preview["total_points"],
        "total_players": preview["total_players"],
        "duration_sec":  preview["duration_sec"],
        "preview":       preview,
    }


def _update_player_profiles(db: Session, match_id: int, players_data: list):
    """GPS 분석 완료 후 PlayerProfile 누적 통계 갱신."""
    from datetime import datetime as dt
    for p in players_data:
        jersey = p.get("_jersey_number") or 0
        name   = p.get("_player_name") or p.get("comment", "").split(" ")[-1]
        if not jersey:
            continue
        profile = db.query(PlayerProfile).filter(PlayerProfile.jersey_number == jersey).first()
        if not profile:
            profile = PlayerProfile(jersey_number=jersey, player_name=name)
            db.add(profile)
        profile.total_matches   += 1
        profile.total_distance_m += p.get("total_distance_m", 0)
        profile.total_sprints    += p.get("sprint_count", 0)
        # 이동평균 피로도
        n = profile.total_matches
        profile.avg_fatigue = ((profile.avg_fatigue * (n - 1)) + p.get("fatigue_index", 0)) / n
        profile.updated_at = dt.utcnow()


# ── GET /api/matches/{id}/gps-data ────────────────────────────────────────
@router.get("/{match_id}/gps-data")
def get_gps_data(match_id: int, db: Session = Depends(get_db)):
    """저장된 GPS 원본 트랙 포인트 반환 (시각화용)."""
    pts = db.query(GpsTrackPoint).filter(
        GpsTrackPoint.match_id == match_id
    ).order_by(GpsTrackPoint.timestamp_ms).all()
    return [
        {
            "player_id":     p.player_id,
            "player_name":   p.player_name,
            "jersey_number": p.jersey_number,
            "team_side":     p.team_side,
            "timestamp_ms":  p.timestamp_ms,
            "lat": p.lat, "lng": p.lng,
            "speed_mps": p.speed_mps,
            "x": p.norm_x, "y": p.norm_y,
        }
        for p in pts
    ]


# ── GET /api/players/{jersey} ─────────────────────────────────────────────
from fastapi import APIRouter as _APIRouter

players_router = _APIRouter(prefix="/api/players", tags=["players"])


@players_router.get("/{jersey_number}", response_model=PlayerProfileOut)
def get_player_profile(jersey_number: int, db: Session = Depends(get_db)):
    profile = db.query(PlayerProfile).filter(PlayerProfile.jersey_number == jersey_number).first()
    if not profile:
        raise HTTPException(404, f"등번호 {jersey_number} 선수 프로필 없음")
    return profile


@players_router.get("/{jersey_number}/history", response_model=List[PlayerMatchHistoryItem])
def get_player_history(jersey_number: int, db: Session = Depends(get_db)):
    """해당 등번호 선수의 경기별 이력 반환 (GPS 분석 경기에서 track_id 매칭)."""
    track_id_prefix = f"gps_{jersey_number}"
    summaries = db.query(PlayerTrackSummary).filter(
        PlayerTrackSummary.track_id.like(f"{track_id_prefix}%")
    ).all()

    history = []
    for s in summaries:
        m = db.query(Match).filter(Match.id == s.match_id).first()
        if not m:
            continue
        history.append(PlayerMatchHistoryItem(
            match_id=m.id,
            match_title=m.title,
            match_date=m.date,
            total_distance_m=s.total_distance_m,
            sprint_count=s.sprint_count,
            fatigue_index=s.fatigue_index,
            data_source=m.data_source or "sample",
        ))
    return sorted(history, key=lambda h: h.match_id, reverse=True)


@players_router.get("", response_model=List[PlayerProfileOut])
def list_player_profiles(db: Session = Depends(get_db)):
    return db.query(PlayerProfile).order_by(PlayerProfile.jersey_number).all()
