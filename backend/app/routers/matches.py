import os
import threading
import logging
from typing import List

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Match, PlayerTrackSummary, FrameTracking
from app.schemas import MatchCreate, MatchOut, AnalyzeRequest

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/matches", tags=["matches"])

UPLOADS_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "uploads")
MAX_FILE_MB = 2048


# ── GET /api/matches ───────────────────────────────────────────────────────
@router.get("", response_model=List[MatchOut])
def list_matches(db: Session = Depends(get_db)):
    return db.query(Match).order_by(Match.created_at.desc()).all()


# ── POST /api/matches ──────────────────────────────────────────────────────
@router.post("", response_model=MatchOut, status_code=201)
def create_match(body: MatchCreate, db: Session = Depends(get_db)):
    match = Match(**body.model_dump())
    db.add(match)
    db.commit()
    db.refresh(match)
    return match


# ── GET /api/matches/{id} ──────────────────────────────────────────────────
@router.get("/{match_id}", response_model=MatchOut)
def get_match(match_id: int, db: Session = Depends(get_db)):
    m = db.query(Match).filter(Match.id == match_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Match not found")
    return m


# ── POST /api/matches/{id}/upload ─────────────────────────────────────────
@router.post("/{match_id}/upload")
async def upload_video(
    match_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    m = db.query(Match).filter(Match.id == match_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Match not found")

    ext = (file.filename or "").split(".")[-1].lower()
    if ext not in ("mp4", "mov"):
        raise HTTPException(status_code=400, detail="MP4 또는 MOV 파일만 허용됩니다")

    content = await file.read()
    size_mb = len(content) / (1024 * 1024)
    if size_mb > MAX_FILE_MB:
        raise HTTPException(status_code=413, detail=f"파일이 너무 큽니다 (최대 {MAX_FILE_MB}MB)")

    save_dir = os.path.join(UPLOADS_DIR, str(match_id))
    os.makedirs(save_dir, exist_ok=True)
    save_path = os.path.join(save_dir, file.filename or "video.mp4")

    with open(save_path, "wb") as f:
        f.write(content)

    m.video_filename = file.filename
    m.status = "uploaded"
    db.commit()

    return {"filename": file.filename, "size_mb": round(size_mb, 2), "message": "업로드 완료"}


# ── POST /api/matches/{id}/analyze ────────────────────────────────────────
@router.post("/{match_id}/analyze")
def start_analyze(
    match_id: int,
    body: AnalyzeRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    m = db.query(Match).filter(Match.id == match_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Match not found")
    if m.status == "analyzing":
        raise HTTPException(status_code=409, detail="이미 분석 중입니다")

    from app.services.analysis_service import run_analysis

    # BackgroundTasks로 비동기 실행 (새 DB 세션 사용)
    from app.database import SessionLocal

    def _run():
        _db = SessionLocal()
        try:
            _match = _db.query(Match).filter(Match.id == match_id).first()
            run_analysis(_db, _match, use_sample=body.use_sample)
        finally:
            _db.close()

    background_tasks.add_task(_run)

    m.status = "analyzing"
    db.commit()

    return {"status": "analyzing", "message": "분석을 시작합니다. 잠시 기다려주세요."}


# ── GET /api/matches/{id}/summary ─────────────────────────────────────────
@router.get("/{match_id}/summary")
def get_summary(match_id: int, db: Session = Depends(get_db)):
    m = db.query(Match).filter(Match.id == match_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Match not found")
    if m.status != "done":
        raise HTTPException(status_code=400, detail="분석이 완료되지 않았습니다")

    players = db.query(PlayerTrackSummary).filter(PlayerTrackSummary.match_id == match_id).all()

    from app.schemas import MatchOut, PlayerOut, MatchSummaryOut

    home_p = [p for p in players if p.team_side == "home"]
    away_p = [p for p in players if p.team_side == "away"]

    def avg_pos(lst, axis):
        if not lst:
            return 0.5
        vals = [getattr(p, f"avg_position_{axis}") for p in lst]
        return round(sum(vals) / len(vals), 4)

    total_dist = sum(p.total_distance_m for p in players)

    return {
        "match":          MatchOut.model_validate(m),
        "players":        [PlayerOut.model_validate(p) for p in players],
        "home_avg_x":     avg_pos(home_p, "x"),
        "home_avg_y":     avg_pos(home_p, "y"),
        "away_avg_x":     avg_pos(away_p, "x"),
        "away_avg_y":     avg_pos(away_p, "y"),
        "total_distance_km": round(total_dist, 2),
    }


# ── GET /api/matches/{id}/players ─────────────────────────────────────────
@router.get("/{match_id}/players")
def list_players(match_id: int, db: Session = Depends(get_db)):
    from app.schemas import PlayerOut
    players = db.query(PlayerTrackSummary).filter(PlayerTrackSummary.match_id == match_id).all()
    return [PlayerOut.model_validate(p) for p in players]


# ── GET /api/matches/{id}/players/{trackId} ────────────────────────────────
@router.get("/{match_id}/players/{track_id}")
def get_player_detail(match_id: int, track_id: str, db: Session = Depends(get_db)):
    from app.schemas import PlayerOut, FramePointOut, PlayerDetailOut

    p = db.query(PlayerTrackSummary).filter(
        PlayerTrackSummary.match_id == match_id,
        PlayerTrackSummary.track_id == track_id,
    ).first()
    if not p:
        raise HTTPException(status_code=404, detail="Player not found")

    # 프레임은 최대 300개만 반환 (성능)
    frames = (
        db.query(FrameTracking)
        .filter(FrameTracking.match_id == match_id, FrameTracking.track_id == track_id)
        .order_by(FrameTracking.frame_index)
        .limit(300)
        .all()
    )

    result = PlayerOut.model_validate(p).model_dump()
    result["frames"] = [FramePointOut.model_validate(f).model_dump() for f in frames]
    return result
