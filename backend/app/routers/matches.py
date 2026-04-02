import os, logging
from typing import List
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Match, PlayerTrackSummary, FrameTracking, MatchAnalytics
from app.schemas import MatchCreate, MatchOut, AnalyzeRequest, MatchSummaryOut, MatchAnalyticsOut, PlayerOut

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
    save_dir = os.path.join(UPLOADS_DIR, str(match_id))
    os.makedirs(save_dir, exist_ok=True)
    with open(os.path.join(save_dir, file.filename or "video.mp4"), "wb") as f:
        f.write(content)
    m.video_filename = file.filename; m.status = "uploaded"; db.commit()
    return {"filename": file.filename, "size_mb": round(size_mb,2), "message": "업로드 완료"}


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
    return {"status": "analyzing", "message": "분석 시작"}


@router.get("/{match_id}/summary")
def get_summary(match_id: int, db: Session = Depends(get_db)):
    m = db.query(Match).filter(Match.id == match_id).first()
    if not m: raise HTTPException(404, "Match not found")
    if m.status != "done": raise HTTPException(400, "분석 미완료")

    players = db.query(PlayerTrackSummary).filter(PlayerTrackSummary.match_id == match_id).all()
    analytics = db.query(MatchAnalytics).filter(MatchAnalytics.match_id == match_id).first()

    home_p = [p for p in players if p.team_side == "home"]
    away_p = [p for p in players if p.team_side == "away"]

    def avg(lst, attr): return round(sum(getattr(p, attr) for p in lst)/len(lst), 4) if lst else 0.5

    total_dist = sum(p.total_distance_m for p in players)

    return {
        "match": MatchOut.model_validate(m),
        "players": [PlayerOut.model_validate(p) for p in players],
        "home_avg_x": avg(home_p, "avg_position_x"),
        "home_avg_y": avg(home_p, "avg_position_y"),
        "away_avg_x": avg(away_p, "avg_position_x"),
        "away_avg_y": avg(away_p, "avg_position_y"),
        "total_distance_km": round(total_dist, 2),
        "analytics": MatchAnalyticsOut.model_validate(analytics) if analytics else None,
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
