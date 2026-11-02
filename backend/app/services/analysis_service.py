"""분석 실행 오케스트레이터.

mode
  sample : 가상 경기(시뮬레이터)로 전체 결과 화면을 체험한다. 실제 영상과 무관함을 결과에 표시.
  video  : 업로드한 영상을 분석한다.
           1) RUNPOD_API_KEY + RUNPOD_ENDPOINT_ID → RunPod GPU 워커
           2) 이 서버에 ultralytics가 설치돼 있으면 → 서버에서 직접(CPU면 느림)
           3) 둘 다 없으면 실패로 끝낸다 — 예전처럼 샘플 데이터로 몰래 대체하지 않는다.
"""

from __future__ import annotations

import importlib.util
import json
import logging
import os
import tempfile
import time
from typing import Dict, Optional

from app.database import SessionLocal
from app.models import Match
from app.services import runpod_service
from app.services.result_service import save_result
from app.vision.pipeline import AnalysisConfig, analyze_simulated

logger = logging.getLogger(__name__)

UPLOADS_DIR = os.environ.get("UPLOAD_DIR", os.path.join(os.path.dirname(__file__), "..", "..", "uploads"))


def local_engine_available() -> bool:
    return importlib.util.find_spec("ultralytics") is not None and importlib.util.find_spec("cv2") is not None


def engines() -> Dict[str, bool]:
    return {"runpod": runpod_service.is_configured(), "local": local_engine_available()}


def local_video_path(match: Match) -> Optional[str]:
    url = match.video_url or ""
    if not url.startswith("local:"):
        return None
    rel = url[len("local:"):]
    base = os.path.realpath(UPLOADS_DIR)
    path = os.path.realpath(os.path.join(base, rel))
    if not path.startswith(base + os.sep):
        return None
    return path


def build_config(match: Match, options: Optional[Dict] = None) -> AnalysisConfig:
    options = options or {}
    cal = None
    if match.calibration_json:
        try:
            cal = json.loads(match.calibration_json)
        except ValueError:
            cal = None
    return AnalysisConfig(
        field_type=match.field_type or "soccer",
        home_color=match.home_team_color,
        away_color=match.away_team_color,
        referee_color=match.referee_color or None,
        home_gk_color=match.home_gk_color or None,
        away_gk_color=match.away_gk_color or None,
        calibration=cal,
        home_attacks=match.home_attacks or "auto",
        halftime_s=match.halftime_s,
        start_seconds=float(options.get("start_seconds") or 0.0),
        max_seconds=options.get("max_seconds") or None,
        quality=options.get("quality") or "standard",
    )


class _Progress:
    """진행률을 DB에 기록 (너무 잦은 커밋 방지)."""

    def __init__(self, match_id: int):
        self.match_id = match_id
        self.last = 0.0

    def __call__(self, pct: float, msg: str):
        now = time.time()
        if now - self.last < 1.5 and pct < 99:
            return
        self.last = now
        db = SessionLocal()
        try:
            m = db.get(Match, self.match_id)
            if m is not None and m.status == "analyzing":
                m.analysis_progress = round(max(0.0, min(99.0, pct)), 1)
                m.analysis_message = msg[:250]
                db.commit()
        finally:
            db.close()


def _run_video(match: Match, cfg: AnalysisConfig, progress: _Progress) -> Dict:
    if not match.video_url:
        raise RuntimeError("업로드된 영상이 없습니다.")
    local = local_video_path(match)
    if runpod_service.is_configured() and match.video_url.startswith("http"):
        return runpod_service.run_analysis_on_runpod(match.video_url, cfg.__dict__, progress)
    if local_engine_available():
        from app.vision.pipeline import analyze_video
        if local:
            return analyze_video(local, cfg, progress=progress)
        if match.video_url.startswith("http"):
            import requests
            fd, path = tempfile.mkstemp(suffix=".mp4")
            os.close(fd)
            try:
                progress(1, "영상 내려받는 중")
                with requests.get(match.video_url, stream=True, timeout=60) as r:
                    r.raise_for_status()
                    with open(path, "wb") as f:
                        for chunk in r.iter_content(8 * 1024 * 1024):
                            f.write(chunk)
                return analyze_video(path, cfg, progress=progress)
            finally:
                os.remove(path)
    if local and runpod_service.is_configured():
        raise RuntimeError("서버에 저장된 영상은 RunPod가 내려받을 수 없습니다. R2 저장소를 설정해 다시 업로드하세요.")
    raise RuntimeError("영상 분석 엔진이 설정되지 않았습니다. RunPod(RUNPOD_API_KEY, RUNPOD_ENDPOINT_ID)를 설정하거나 "
                       "서버에 requirements-worker.txt를 설치하세요. 화면 체험은 '샘플 분석'으로 할 수 있습니다.")


def run_analysis(match_id: int, mode: str = "video", options: Optional[Dict] = None) -> None:
    """백그라운드에서 실행된다. 결과·오류를 모두 DB에 기록한다."""
    progress = _Progress(match_id)
    db = SessionLocal()
    try:
        match = db.get(Match, match_id)
        if match is None:
            return
        cfg = build_config(match, options)
        if mode == "sample":
            players = 5 if cfg.field_type == "futsal" else 11
            duration = 1200.0 if cfg.field_type == "futsal" else 1800.0
            if cfg.max_seconds:
                duration = max(60.0, min(duration, float(cfg.max_seconds)))
            result = analyze_simulated(cfg, duration_s=duration, seed=match_id, players_per_team=players,
                                       progress=progress)
            result["meta"]["sample"] = True
            source = "sample"
        else:
            result = _run_video(match, cfg, progress)
            source = "video"
        db.refresh(match)
        save_result(db, match, result, source)
        db.commit()
        logger.info("분석 완료: match=%s 선수=%d 이벤트=%d", match_id, len(result["players"]), len(result["events"]))
    except Exception as e:  # noqa: BLE001 — 어떤 실패든 사용자에게 보여야 한다
        logger.exception("분석 실패: match=%s", match_id)
        db.rollback()
        match = db.get(Match, match_id)
        if match is not None:
            match.status = "failed"
            match.analysis_error = str(e)[:2000]
            match.analysis_message = "분석 실패"
            db.commit()
    finally:
        db.close()


def recover_interrupted() -> int:
    """서버 재시작으로 끊긴 '분석 중' 경기를 실패로 표시."""
    db = SessionLocal()
    try:
        # GPU 서버에 맡긴 작업은 서버가 재시작돼도 계속 돈다 — 상태 조회 때 이어서 확인한다
        stuck = db.query(Match).filter(Match.status == "analyzing", Match.runpod_job_id.is_(None)).all()
        for m in stuck:
            m.status = "failed"
            m.analysis_error = "서버가 재시작되어 분석이 중단되었습니다. 다시 시도하세요."
        db.commit()
        return len(stuck)
    finally:
        db.close()
