import base64
import json
import logging
import os
import re
import shutil
from datetime import datetime, timezone
from typing import Dict, List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response, StreamingResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Match, MatchEvent, MatchPlayer
from app.schemas import (AIReportOut, AnalyzeRequest, CalibrationIn, EventCreate, EventUpdate, MatchCreate, MatchOut,
                         MatchUpdate, MergeRequest, PlayerUpdate, StatusOut, VideoUrlBody)
from app.services import ai_report_service, analysis_service
from app.services.ai_report_service import build_player_context, context_basis
from app.services.result_service import (CURRENT_VERSION, build_view, export_csv, head_player, overlay_gzip_bytes,
                                         thumbnail_for)

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
def get_result(match_id: int, period: Optional[int] = Query(default=None, ge=1, le=2),
               db: Session = Depends(get_db)):
    """period=1 전반, 2 후반 (경기 설정의 후반 시작 시각 기준)."""
    m = _get(db, match_id)
    _require_result(m)
    view = build_view(db, m, period=period)
    view["match"] = _out(m).model_dump(mode="json")
    _annotate_ai_reports(db, m, view)
    return view


@router.get("/{match_id}/overlay")
def get_overlay(match_id: int, db: Session = Depends(get_db)):
    """영상 검수용 프레임별 선수 박스·공 위치. 저장된 gzip을 그대로 보낸다(브라우저가 풀어 읽는다).

    형식: {v, w, h, start_s, step, n, tracks: {track_id: [[k, x1, y1, x2, y2], ...]}, ball: [[k, x, y, detected], ...]}
    k는 분석 프레임 번호(시각 = start_s + k*step), 좌표는 원본 영상 픽셀.
    """
    m = _get(db, match_id)
    _require_result(m)
    gz = overlay_gzip_bytes(m)
    if gz is None:
        raise HTTPException(404, "이 분석에는 영상 검수 데이터가 없습니다. 최신 엔진으로 다시 분석하세요.")
    return Response(content=gz, media_type="application/json",
                    headers={"Content-Encoding": "gzip", "Cache-Control": "private, max-age=60"})


@router.get("/{match_id}/export.csv")
def export_players_csv(match_id: int, period: Optional[int] = Query(default=None, ge=1, le=2),
                       db: Session = Depends(get_db)):
    m = _get(db, match_id)
    _require_result(m)
    data = export_csv(m, build_view(db, m, include_events=False, period=period))
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


# ── AI 선수 분석 ────────────────────────────────────────────────────────────

def _utc(dt: Optional[datetime]) -> Optional[datetime]:
    """DB에는 UTC naive로 저장 → 응답에는 시간대를 붙여 브라우저가 현지 시각으로 바꾸게 한다."""
    return dt.replace(tzinfo=timezone.utc) if dt is not None and dt.tzinfo is None else dt


def _full_view(db: Session, m: Match) -> Dict:
    view = build_view(db, m)
    view["match"] = _out(m).model_dump(mode="json")
    return view


def _head_player(db: Session, match_id: int, track_id: str) -> MatchPlayer:
    p = head_player(db, match_id, track_id)
    if not p:
        raise HTTPException(404, "선수(트랙)를 찾을 수 없습니다")
    return p


def _current_basis(view: Dict, track_id: str) -> Optional[str]:
    try:
        return context_basis(build_player_context(view, track_id))
    except KeyError:
        return None


def _report_out(p: MatchPlayer, basis: Optional[str]) -> Optional[AIReportOut]:
    try:
        data = json.loads(p.ai_report_json or "")
        return AIReportOut(track_id=p.track_id, report=data["report"], model=data.get("model") or "",
                           usage=data.get("usage") or {}, generated_at=_utc(p.ai_report_at),
                           stale=basis is not None and basis != p.ai_report_basis)
    except (ValueError, KeyError, TypeError):
        return None


def _annotate_ai_reports(db: Session, m: Match, view: Dict) -> None:
    """결과 뷰의 선수마다 ai_report_at·ai_report_stale. 분석이 있는 선수만 기록 해시를 다시 계산한다."""
    rows = {r.track_id: r for r in db.query(MatchPlayer).filter(MatchPlayer.match_id == m.id,
                                                                MatchPlayer.ai_report_at.isnot(None)).all()}
    full = None
    for p in view["players"]:
        r = rows.get(p["track_id"])
        p["ai_report_at"] = _utc(r.ai_report_at).isoformat() if r else None
        p["ai_report_stale"] = None
        if r is None:
            continue
        if full is None:  # 분석은 항상 전체 경기 기록 기준 — 전반/후반 뷰면 전체 뷰를 따로 만든다
            full = view if view.get("period") is None else _full_view(db, m)
        basis = _current_basis(full, p["track_id"])
        p["ai_report_stale"] = None if basis is None else basis != r.ai_report_basis


@router.get("/{match_id}/players/{track_id}/ai-report", response_model=AIReportOut)
def get_ai_report(match_id: int, track_id: str, db: Session = Depends(get_db)):
    """저장된 AI 분석. 없으면 404. stale = 분석 뒤 기록이 바뀜."""
    m = _get(db, match_id)
    _require_result(m)
    p = _head_player(db, match_id, track_id)
    if not p.ai_report_json or not p.ai_report_at:
        raise HTTPException(404, "아직 AI 분석이 없습니다")
    out = _report_out(p, _current_basis(_full_view(db, m), p.track_id))
    if out is None:
        raise HTTPException(404, "저장된 AI 분석을 읽을 수 없습니다. 다시 분석해 주세요.")
    return out


@router.post("/{match_id}/players/{track_id}/ai-report", response_model=AIReportOut)
def create_ai_report(match_id: int, track_id: str, db: Session = Depends(get_db)):
    """전체 경기 기록으로 AI 분석을 새로 만들어 저장한다 (있으면 덮어쓴다). 수십 초 걸릴 수 있다."""
    m = _get(db, match_id)
    _require_result(m)
    p = _head_player(db, match_id, track_id)
    if p.excluded:
        raise HTTPException(400, "제외된 선수는 AI 분석을 받을 수 없습니다")
    if not ai_report_service.is_configured():
        raise HTTPException(503, ai_report_service.NO_KEY_MESSAGE)
    head_id = p.track_id
    ctx = build_player_context(_full_view(db, m), head_id)
    db.rollback()  # AI 응답을 기다리는 동안 DB 연결을 붙잡지 않는다
    try:
        out = ai_report_service.generate_player_report(ctx)
    except ai_report_service.AIReportError as e:
        raise HTTPException(e.status_code, e.message)
    p = _head_player(db, match_id, head_id)
    p.ai_report_json = json.dumps({**out, "context_version": ai_report_service.CONTEXT_VERSION}, ensure_ascii=False)
    p.ai_report_at = datetime.utcnow()
    p.ai_report_basis = ctx["basis"]
    db.commit()
    return _report_out(p, ctx["basis"])


# ── 이벤트 검수 (잘못 잡힌 기록 고치기·지우기·추가) ────────────────────────

def _track_ids(db: Session, match_id: int) -> set:
    return {tid for (tid,) in db.query(MatchPlayer.track_id).filter(MatchPlayer.match_id == match_id).all()}


def _apply_result(ev: MatchEvent, result: Optional[str], target_given: bool, target: Optional[str]):
    detail = json.loads(ev.detail_json or "{}")
    if target_given:
        ev.target = target
    if ev.kind == "pass":
        if result == "out":
            ev.target, ev.success = None, False
            detail["reason"] = "out"
        elif result in ("completed", "intercepted"):
            if not ev.target:
                raise HTTPException(422, "패스를 받은(가로챈) 선수를 지정하세요")
            detail["reason"] = result
            ev.success = result == "completed"
        elif target_given and ev.target and detail.get("reason") == "out":
            detail["reason"] = "completed"
    elif ev.kind == "shot":
        if result:
            if result not in ("on_target", "off_target", "blocked"):
                raise HTTPException(422, "슈팅 결과는 on_target / off_target / blocked 중 하나입니다")
            detail["outcome"] = result
            ev.success = result == "on_target"
            if result != "blocked" and not target_given:
                ev.target = None
    elif result:
        raise HTTPException(422, "볼 탈취에는 결과를 지정하지 않습니다")
    ev.detail_json = json.dumps(detail)


@router.patch("/{match_id}/events/{event_id}")
def update_event(match_id: int, event_id: int, body: EventUpdate, db: Session = Depends(get_db)):
    m = _get(db, match_id)
    _require_result(m)
    ev = db.get(MatchEvent, event_id)
    if not ev or ev.match_id != match_id or ev.kind == "possession":
        raise HTTPException(404, "이벤트를 찾을 수 없습니다")
    data = body.model_dump(exclude_unset=True)
    ids = _track_ids(db, match_id)
    for key in ("player", "target"):
        if data.get(key) and data[key] not in ids:
            raise HTTPException(422, f"없는 선수(트랙)입니다: {data[key]}")
    if data.get("deleted") is not None:
        ev.deleted = data["deleted"]
    if data.get("player"):
        ev.player = data["player"]
    if data.get("t") is not None:
        ev.t = data["t"]
    _apply_result(ev, data.get("result"), "target" in data, data.get("target"))
    ev.edited = True
    db.commit()
    return {"ok": True, "id": ev.id}


@router.post("/{match_id}/events", status_code=201)
def create_event(match_id: int, body: EventCreate, db: Session = Depends(get_db)):
    """자동 분석이 놓친 패스·슈팅·탈취를 직접 추가."""
    m = _get(db, match_id)
    _require_result(m)
    ids = _track_ids(db, match_id)
    for tid in (body.player, body.target):
        if tid and tid not in ids:
            raise HTTPException(422, f"없는 선수(트랙)입니다: {tid}")
    p = _player(db, match_id, body.player)
    last = db.query(MatchEvent.seq).filter(MatchEvent.match_id == match_id).order_by(MatchEvent.seq.desc()).first()
    ev = MatchEvent(match_id=match_id, seq=(last[0] + 1) if last else 0, kind=body.kind, t=body.t, t_end=body.t,
                    team=p.team, player=body.player, target=body.target, success=None, detail_json="{}",
                    manual=True, edited=True)
    default = {"pass": "completed" if body.target else "out", "shot": "off_target"}.get(body.kind)
    _apply_result(ev, body.result or default, False, None)
    db.add(ev)
    db.commit()
    return {"ok": True, "id": ev.id}


@router.post("/{match_id}/events/reset")
def reset_events(match_id: int, db: Session = Depends(get_db)):
    """직접 추가한 이벤트를 지우고 지운 이벤트를 되살린다 (선수·결과 수정은 유지)."""
    _get(db, match_id)
    db.query(MatchEvent).filter(MatchEvent.match_id == match_id, MatchEvent.manual.is_(True)).delete()
    db.query(MatchEvent).filter(MatchEvent.match_id == match_id).update({MatchEvent.deleted: False})
    db.commit()
    return {"ok": True}


# ── 업로드된 영상 목록 (예전에 올린 영상 찾아 다시 분석) ──────────────────────

videos_router = APIRouter(prefix="/api/videos", tags=["videos"])


@videos_router.get("")
def list_videos(db: Session = Depends(get_db)):
    """영상이 연결된 경기 + 저장소(R2)에는 있지만 어느 경기에도 연결되지 않은 영상."""
    matches = db.query(Match).filter(Match.video_url.isnot(None)).order_by(Match.created_at.desc()).all()
    out = []
    for m in matches:
        out.append({
            "match_id": m.id, "title": m.title, "date": m.date, "video_filename": m.video_filename,
            "video_url": m.video_url, "status": m.status, "analysis_version": m.analysis_version or 0,
            "data_source": m.data_source,
            "needs_analysis": (m.analysis_version or 0) != CURRENT_VERSION or m.data_source != "video",
        })
    from app.services import storage_service
    linked = {m.video_url for m in matches}
    orphans = [o for o in storage_service.list_videos() if o["url"] not in linked]
    return {"matches": out, "orphans": orphans, "storage": storage_service.is_configured()}


# ── 선수 프로필 (여러 경기 누적, 이름 기준) ─────────────────────────────────

players_router = APIRouter(prefix="/api/players", tags=["players"])

PROFILE_SUM = ("touches", "passes_attempted", "passes_completed", "passes_failed", "forward_passes", "key_passes",
               "shots", "shots_on_target", "xg", "interceptions", "recoveries", "dispossessed", "seconds_tracked")


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
                    "pass_accuracy", "minutes_tracked")},
            })
    for prof in profiles.values():
        t = prof["totals"]
        t["pass_accuracy"] = round(t["passes_completed"] / t["passes_attempted"] * 100, 1) if t["passes_attempted"] else None
        t["xg"] = round(t["xg"], 2)
        t["minutes"] = round(t["seconds_tracked"] / 60, 1)
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
