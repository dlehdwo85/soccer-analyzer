"""RunPod Serverless 연동 — 워커(backend/worker_handler.py)에 분석을 맡기고 결과를 받는다."""

import logging
import os
import time
from typing import Callable, Dict, Optional

import requests

from app.vision.pipeline import unpack_result

logger = logging.getLogger(__name__)

RUNPOD_BASE_URL = "https://api.runpod.ai/v2"
MAX_WAIT_SEC = int(os.environ.get("RUNPOD_MAX_WAIT_SEC", "5400"))  # 90분 영상 대비
POLL_INTERVAL = 8


def _cfg():
    return os.environ.get("RUNPOD_API_KEY", ""), os.environ.get("RUNPOD_ENDPOINT_ID", "")


def is_configured() -> bool:
    key, ep = _cfg()
    return bool(key and ep)


def _headers():
    return {"Authorization": f"Bearer {_cfg()[0]}", "Content-Type": "application/json"}


def _url(path: str) -> str:
    return f"{RUNPOD_BASE_URL}/{_cfg()[1]}/{path}"


def cancel_job(job_id: str):
    try:
        requests.post(_url(f"cancel/{job_id}"), headers=_headers(), timeout=10)
    except requests.RequestException as e:
        logger.warning("RunPod 작업 취소 실패: %s", e)


def run_analysis_on_runpod(video_url: str, config: Dict,
                           progress: Optional[Callable[[float, str], None]] = None) -> Dict:
    """작업 제출 → 완료까지 폴링 → 결과(version 2) 반환."""
    if not is_configured():
        raise RuntimeError("RUNPOD_API_KEY / RUNPOD_ENDPOINT_ID 환경변수가 설정되지 않았습니다.")
    progress = progress or (lambda p, m: None)
    res = requests.post(_url("run"), json={"input": {"video_url": video_url, "config": config}},
                        headers=_headers(), timeout=30)
    res.raise_for_status()
    job_id = res.json().get("id")
    logger.info("RunPod 작업 제출: %s", job_id)
    progress(2, "GPU 서버 준비 중")

    started = time.time()
    while time.time() - started < MAX_WAIT_SEC:
        time.sleep(POLL_INTERVAL)
        try:
            st = requests.get(_url(f"status/{job_id}"), headers=_headers(), timeout=30).json()
        except (requests.RequestException, ValueError) as e:
            logger.warning("RunPod 상태 조회 실패(재시도): %s", e)
            continue
        state = (st.get("status") or "").upper()
        out = st.get("output")
        if state == "COMPLETED":
            if not isinstance(out, dict):
                raise RuntimeError("RunPod 응답 형식이 올바르지 않습니다.")
            if out.get("status") == "failed":
                raise RuntimeError(f"영상 분석 실패: {out.get('error')}")
            if "result_gz" not in out:
                raise RuntimeError("이전 버전 워커의 응답입니다. backend/Dockerfile.worker로 워커 이미지를 다시 배포하세요.")
            return unpack_result(out["result_gz"])
        if state in ("FAILED", "CANCELLED", "TIMED_OUT"):
            raise RuntimeError(f"RunPod 작업 실패: {state} {st.get('error') or ''}".strip())
        if state == "IN_QUEUE":
            progress(3, "GPU 서버 대기 중")
        elif state == "IN_PROGRESS" and isinstance(out, dict) and "percent" in out:
            progress(float(out["percent"]), out.get("message") or "분석 중")

    cancel_job(job_id)
    raise TimeoutError(f"RunPod 분석 타임아웃 ({MAX_WAIT_SEC}초)")
