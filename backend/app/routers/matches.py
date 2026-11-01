import base64
import json
import logging
import os
import re
import shutil
from typing import Dict, List

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import Response, StreamingResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Match, MatchPlayer
from app.schemas import (AnalyzeRequest, CalibrationIn, MatchCreate, MatchOut, MatchUpdate, MergeRequest,
                         PlayerUpdate, StatusOut, VideoUrlBody)
from app.services import analysis_service
from app.services.result_service import CURRENT_VERSION, build_view, export_csv, save_result, thumbnail_for

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/matches", tags=["matches"])

UPLOADS_DIR = analysis_service.UPLOADS_DIR
MAX_FILE_MB = int(os.environ.get("MAX_UPLOAD_SIZE_MB", "4096"))
VIDEO_EXTS = ("mp4", "mov", "m4v", "mkv", "avi")


def _get(db: Session, match_id: int) -> Match:
    m = db.get(Match, match_id)
    if not m:
        raise HTTPException(404, "경기를 찾을 수 없습니다")
    return m


def _out(m: Match) -> MatchOut:
    o = MatchOut.model_validate(m)
    o.calibrated = bool(m.calibration_json)
    return o


def _ext(filename: str) -> str:
    ext = (filename or "").rsplit(".", 1)[-1].lower()
    if ext not in VIDEO_EXTS:
        raise HTTPException(400, f"영상 파일만 업로드할 수 있습니다 ({', '.join(VIDEO_EXTS)})")
    return ext


def _safe_name(filename: str) -> str:
    base = os.path.basename(filename or "video.mp4")
    return re.sub(r"[^\w.\-가-힣]", "_", base)[:200] or "video.mp4"


# ── 경기 CRUD ───────────────────────────────────────────────────────────────

@router.get("", response_model=List[MatchOut])
def list_matches(db: Session = Depends(get_db)):
    return [_out(m) for m in db.query(Match).order_by(Match.created_at.desc()).all()]


@router.post("", response_model=MatchOut, status_code=201)
def create_match(body: MatchCreate, db: Session = Depends(get_db)):
    m = Match(**body.model_dump())
    db.add(m)
    db.commit()
    db.refresh(m)
    return _out(m)


@router.get("/{match_id}", response_model=MatchOut)
def get_match(match_id: int, db: Session = Depends(get_db)):
    return _out(_get(db, match_id))


@router.patch("/{match_id}", response_model=MatchOut)
def update_match(match_id: int, body: MatchUpdate, db: Session = Depends(get_db)):
    m = _get(db, match_id)
    for k, v in body.model_dump(exclude_unset=True).items():
        if k in ("title", "field_type", "home_team_color", "away_team_color", "home_attacks") and v is None:
            continue
        setattr(m, k, v)
    db.commit()
    db.refresh(m)
    return _out(m)


@router.delete("/{match_id}", status_code=204)
def delete_match(match_id: int, db: Session = Depends(get_db)):
    m = _get(db, match_id)
    if m.status == "analyzing":
        raise HTTPException(409, "분석 중인 경기는 삭제할 수 없습니다")
    local_dir = os.path.join(UPLOADS_DIR, str(match_id))
    db.delete(m)
    db.commit()
    shutil.rmtree(local_dir, ignore_errors=True)
    return Response(status_code=204)


# ── 영상 ────────────────────────────────────────────────────────────────────

@router.post("/{match_id}/upload")
async def upload_video(match_id: int, file: UploadFile = File(...), db: Session = Depends(get_db)):
    """서버 디스크에 직접 저장 (R2를 쓰지 않는 로컬/소규모 배포용)."""
    m = _get(db, match_id)
    ext = _ext(file.filename)
    save_dir = os.path.join(UPLOADS_DIR, str(match_id))
    os.makedirs(save_dir, exist_ok=True)
    dest = os.path.join(save_dir, f"video.{ext}")
    size = 0
    with open(dest, "wb") as f:
        while chunk := await file.read(8 * 1024 * 1024):
            size += len(chunk)
            if size > MAX_FILE_MB * 1024 * 1024:
                f.close()
                os.remove(dest)
                raise HTTPException(413, f"최대 {MAX_FILE_MB}MB까지 업로드할 수 있습니다")
            f.write(chunk)
    m.video_filename = _safe_name(file.filename)
    m.video_url = f"local:{match_id}/video.{ext}"
    m.status = "uploaded" if m.status != "done" else m.status
    db.commit()
    return {"filename": m.video_filename, "size_mb": round(size / 1024 / 1024, 2), "video_url": m.video_url}


@router.get("/{match_id}/upload-url")
def get_upload_url(match_id: int, filename: str, db: Session = Depends(get_db)):
    """브라우저 → R2 직접 업로드용 presigned URL. R2 미설정이면 404 (프론트가 서버 업로드로 전환)."""
    _get(db, match_id)
    _ext(filename)
    from app.services.storage_service import get_presigned_upload_url
    result = get_presigned_upload_url(match_id, _safe_name(filename))
    if not result:
        raise HTTPException(404, "R2 저장소가 설정되지 않았습니다")
    return result


@router.post("/{match_id}/set-video-url")
def set_video_url(match_id: int, body: VideoUrlBody, db: Session = Depends(get_db)):
    m = _get(db, match_id)
    if not body.video_url.startswith("https://"):
        raise HTTPException(400, "https URL만 허용됩니다")
    m.video_url = body.video_url
    m.video_filename = _safe_name(body.filename)
    m.status = "uploaded" if m.status != "done" else m.status
    db.commit()
    return {"video_url": m.video_url}


@router.get("/{match_id}/video")
def stream_video(match_id: int, request: Request, db: Session = Depends(get_db)):
    """서버에 저장된 영상 스트리밍 (Range 지원 — 이벤트 시점으로 이동 가능)."""
    m = _get(db, match_id)
    path = analysis_service.local_video_path(m)
    if not path or not os.path.exists(path):
        raise HTTPException(404, "서버에 저장된 영상이 없습니다")
    size = os.path.getsize(path)
    ctype = "video/quicktime" if path.endswith(".mov") else "video/mp4"
    rng = request.headers.get("range")
    start, end = 0, size - 1
    status = 200
    if rng and (mt := re.match(r"bytes=(\d*)-(\d*)", rng)):
        if mt.group(1):
            start = int(mt.group(1))
            end = int(mt.group(2)) if mt.group(2) else min(size - 1, start + 4 * 1024 * 1024)
        elif mt.group(2):
            start = max(0, size - int(mt.group(2)))
        end = min(end, size - 1)
        if start > end:
            raise HTTPException(416, "잘못된 범위")
        status = 206

    def body():
        with open(path, "rb") as f:
            f.seek(start)
            left = end - start + 1
            while left > 0:
                chunk = f.read(min(1024 * 1024, left))
                if not chunk:
                    break
                left -= len(chunk)
                yield chunk

    headers = {"Accept-Ranges": "bytes", "Content-Length": str(end - start + 1)}
    if status == 206:
        headers["Content-Range"] = f"bytes {start}-{end}/{size}"
    return StreamingResponse(body(), status_code=status, media_type=ctype, headers=headers)


# ── 경기장 보정 ─────────────────────────────────────────────────────────────

@router.put("/{match_id}/calibration", response_model=MatchOut)
def set_calibration(match_id: int, body: CalibrationIn, db: Session = Depends(get_db)):
    from app.vision.pitch import calibration_from_preset, field_dims, homography
    m = _get(db, match_id)
    length, width = field_dims(m.field_type or "soccer", body.length, body.width)
    if body.preset == "custom":
        if not body.pitch_points or len(body.pitch_points) != 4:
            raise HTTPException(422, "custom 보정에는 pitch_points 4개가 필요합니다")
        cal = {"preset": "custom", "image_points": body.image_points, "pitch_points": body.pitch_points,
               "length": length, "width": width}
    else:
        cal = calibration_from_preset(body.preset, body.image_points, length, width)
    try:
        homography(cal["image_points"], cal["pitch_points"])
    except ValueError as e:
        raise HTTPException(422, f"보정 점이 올바르지 않습니다: {e}")
    m.calibration_json = json.dumps(cal)
    db.commit()
    db.refresh(m)
    return _out(m)


@router.get("/{match_id}/calibration")
def get_calibration(match_id: int, db: Session = Depends(get_db)):
    m = _get(db, match_id)
    return json.loads(m.calibration_json) if m.calibration_json else None


@router.delete("/{match_id}/calibration", response_model=MatchOut)
def clear_calibration(match_id: int, db: Session = Depends(get_db)):
    m = _get(db, match_id)
    m.calibration_json = None
    db.commit()
    db.refresh(m)
    return _out(m)


# ── 분석 ────────────────────────────────────────────────────────────────────

@router.post("/{match_id}/analyze")
def start_analyze(match_id: int, body: AnalyzeRequest, background_tasks: BackgroundTasks,
                  db: Session = Depends(get_db)):
    m = _get(db, match_id)
    if m.status == "analyzing":
        raise HTTPException(409, "이미 분석 중입니다")
    mode = "sample" if body.use_sample else body.mode
    if mode == "video":
        if not m.video_url:
            raise HTTPException(400, "먼저 영상을 업로드하세요")
        eng = analysis_service.engines()
        if not (eng["runpod"] or eng["local"]):
            raise HTTPException(503, "영상 분석 엔진이 설정되지 않았습니다. RunPod를 설정하거나 '샘플 분석'으로 화면을 체험하세요.")
    m.status = "analyzing"
    m.analysis_progress = 0.0
    m.analysis_message = "분석 대기 중"
    m.analysis_error = None
    db.commit()
    background_tasks.add_task(analysis_service.run_analysis, match_id, mode,
                              {"start_seconds": body.start_seconds, "max_seconds": body.max_seconds})
    return {"status": "analyzing", "mode": mode}


@router.get("/{match_id}/status", response_model=StatusOut)
def get_status(match_id: int, db: Session = Depends(get_db)):
    m = _get(db, match_id)
    return StatusOut(status=m.status, progress=m.analysis_progress or 0, message=m.analysis_message or "",
                     error=m.analysis_error, has_result=(m.analysis_version or 0) == CURRENT_VERSION)


def _require_result(m: Match):
    if (m.analysis_version or 0) != CURRENT_VERSION:
        if m.status == "done":
            raise HTTPException(409, "이전 버전으로 분석된 경기입니다. 다시 분석해 주세요.")
        raise HTTPException(409, "분석 결과가 없습니다")


@router.get("/{match_id}/result")
def get_result(match_id: int, db: Session = Depends(get_db)):
    m = _get(db, match_id)
    _require_result(m)
    view = build_view(db, m)
    view["match"] = _out(m).model_dump(mode="json")
    return view


@router.get("/{match_id}/export.csv")
def export_players_csv(match_id: int, db: Session = Depends(get_db)):
    m = _get(db, match_id)
    _require_result(m)
    data = export_csv(m, build_view(db, m, include_events=False))
    return Response(data, media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="match_{match_id}_players.csv"'})


# ── 트랙(선수) 편집 ─────────────────────────────────────────────────────────

def _player(db: Session, match_id: int, track_id: str) -> MatchPlayer:
    p = (db.query(MatchPlayer)
         .filter(MatchPlayer.match_id == match_id, MatchPlayer.track_id == track_id).first())
    if not p:
        raise HTTPException(404, "선수(트랙)를 찾을 수 없습니다")
    return p


@router.get("/{match_id}/players/{track_id}/thumbnail.jpg")
def player_thumbnail(match_id: int, track_id: str, db: Session = Depends(get_db)):
    b64 = thumbnail_for(db, match_id, track_id)
    if not b64:
        raise HTTPException(404, "썸네일 없음")
    return Response(base64.b64decode(b64), media_type="image/jpeg",
                    headers={"Cache-Control": "public, max-age=86400"})


@router.patch("/{match_id}/players/{track_id}")
def update_player(match_id: int, track_id: str, body: PlayerUpdate, db: Session = Depends(get_db)):
    p = _player(db, match_id, track_id)
    if p.merged_into:
        raise HTTPException(400, "다른 선수에 병합된 트랙입니다. 병합을 먼저 해제하세요.")
    data = body.model_dump(exclude_unset=True)
    if "display_name" in data:
        p.display_name = (data["display_name"] or "").strip() or None
    if "jersey_number" in data:
        p.jersey_number = data["jersey_number"]
    if data.get("team"):
        p.team = data["team"]
        p.label = data["team"] + ("_gk" if (p.label or "").endswith("_gk") else "")
    if data.get("excluded") is not None:
        p.excluded = data["excluded"]
    db.commit()
    return {"ok": True}


@router.post("/{match_id}/players/merge")
def merge_players(match_id: int, body: MergeRequest, db: Session = Depends(get_db)):
    """같은 사람인데 여러 트랙으로 나뉜 경우 하나로 합친다 (되돌릴 수 있음)."""
    target = _player(db, match_id, body.target)
    if target.merged_into:
        raise HTTPException(400, "병합 대상이 이미 다른 선수에 병합되어 있습니다")
    for sid in body.sources:
        if sid == body.target:
            continue
        src = _player(db, match_id, sid)
        src.merged_into = target.track_id
        # src에 이미 병합돼 있던 트랙도 target으로 옮긴다
        for child in db.query(MatchPlayer).filter(MatchPlayer.match_id == match_id,
                                                  MatchPlayer.merged_into == sid).all():
            child.merged_into = target.track_id
        if not target.display_name and src.display_name:
            target.display_name = src.display_name
        if target.jersey_number is None and src.jersey_number is not None:
            target.jersey_number = src.jersey_number
    db.commit()
    return {"ok": True}


@router.post("/{match_id}/players/{track_id}/unmerge")
def unmerge_player(match_id: int, track_id: str, db: Session = Depends(get_db)):
    p = _player(db, match_id, track_id)
    p.merged_into = None
    db.commit()
    return {"ok": True}


# ── GPS ─────────────────────────────────────────────────────────────────────

async def _read_gps(file: UploadFile) -> bytes:
    ext = (file.filename or "").rsplit(".", 1)[-1].lower()
    if ext not in ("csv", "json", "gpx"):
        raise HTTPException(400, "CSV, JSON, GPX 파일만 지원합니다")
    content = await file.read()
    if len(content) > 50 * 1024 * 1024:
        raise HTTPException(413, "GPS 파일은 50MB 이하만 지원합니다")
    return content


@router.post("/{match_id}/gps-preview")
async def gps_preview(match_id: int, file: UploadFile = File(...), db: Session = Depends(get_db)):
    _get(db, match_id)
    content = await _read_gps(file)
    from app.services.gps_service import get_gps_preview
    try:
        return get_gps_preview(file.filename, content)
    except ValueError as e:
        raise HTTPException(422, str(e))


@router.post("/{match_id}/upload-gps")
async def upload_gps(match_id: int, file: UploadFile = File(...), db: Session = Depends(get_db)):
    m = _get(db, match_id)
    if m.status == "analyzing":
        raise HTTPException(409, "이미 분석 중입니다")
    content = await _read_gps(file)
    from app.services.gps_service import build_gps_result, parse_gps_file
    try:
        points = parse_gps_file(file.filename, content)
        result = build_gps_result(points, m.field_type or "soccer")
    except ValueError as e:
        raise HTTPException(422, str(e))
    save_result(db, m, result, "gps")
    db.commit()
    return {"message": "GPS 분석 완료", "players": len(result["players"]), "points": len(points),
            "duration_s": result["meta"]["duration_s"]}


# ── 선수 프로필 (여러 경기 누적, 이름 기준) ─────────────────────────────────

players_router = APIRouter(prefix="/api/players", tags=["players"])

PROFILE_SUM = ("touches", "passes_attempted", "passes_completed", "shots", "shots_on_target", "xg",
               "interceptions", "recoveries", "distance_m", "sprint_count", "seconds_tracked")


def _collect_profiles(db: Session) -> Dict[str, Dict]:
    match_ids = [mid for (mid,) in db.query(MatchPlayer.match_id)
                 .filter(MatchPlayer.display_name.isnot(None)).distinct().all()]
    profiles: Dict[str, Dict] = {}
    for mid in match_ids:
        m = db.get(Match, mid)
        if not m or (m.analysis_version or 0) != CURRENT_VERSION:
            continue
        view = build_view(db, m, include_events=False)
        for p in view["players"]:
            if not p["display_name"] or p["excluded"]:
                continue
            key = p["display_name"].strip()
            prof = profiles.setdefault(key, {"name": key, "jersey_number": p["jersey_number"],
                                             "matches": [], "totals": {k: 0 for k in PROFILE_SUM}})
            s = p["stats"]
            for k in PROFILE_SUM:
                prof["totals"][k] += s.get(k) or 0
            prof["matches"].append({
                "match_id": m.id, "title": m.title, "date": m.date, "data_source": m.data_source,
                "team_name": m.home_team_name if p["team"] == "home" else m.away_team_name,
                "track_id": p["track_id"], "stats": {k: s.get(k) for k in PROFILE_SUM + (
                    "pass_accuracy", "top_speed_kmh", "minutes_tracked")},
            })
    for prof in profiles.values():
        t = prof["totals"]
        t["pass_accuracy"] = round(t["passes_completed"] / t["passes_attempted"] * 100, 1) if t["passes_attempted"] else None
        t["xg"] = round(t["xg"], 2)
        t["distance_m"] = round(t["distance_m"])
        t["minutes"] = round(t["seconds_tracked"] / 60, 1)
        t["top_speed_kmh"] = max((mm["stats"]["top_speed_kmh"] or 0) for mm in prof["matches"])
        prof["match_count"] = len(prof["matches"])
        prof["matches"].sort(key=lambda mm: mm["match_id"], reverse=True)
    return profiles


@players_router.get("")
def list_profiles(db: Session = Depends(get_db)):
    profs = _collect_profiles(db)
    return sorted(({k: v for k, v in p.items() if k != "matches"} for p in profs.values()),
                  key=lambda p: (-p["match_count"], p["name"]))


@players_router.get("/{name}")
def get_profile(name: str, db: Session = Depends(get_db)):
    prof = _collect_profiles(db).get(name.strip())
    if not prof:
        raise HTTPException(404, "해당 이름의 선수 기록이 없습니다")
    return prof
