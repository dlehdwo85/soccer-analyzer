"""
RunPod Serverless 연동 서비스
==============================
분석 요청 → RunPod GPU 서버 자동 시작 → 완료 후 자동 종료
"""

import os
import time
import logging
import requests

logger = logging.getLogger(__name__)

RUNPOD_API_KEY      = os.environ.get("RUNPOD_API_KEY", "")
RUNPOD_ENDPOINT_ID  = os.environ.get("RUNPOD_ENDPOINT_ID", "")
RUNPOD_BASE_URL     = "https://api.runpod.ai/v2"

MAX_WAIT_SEC   = 1800   # 최대 30분 대기
POLL_INTERVAL  = 10     # 10초마다 상태 확인


def _headers():
    return {
        "Authorization": f"Bearer {RUNPOD_API_KEY}",
        "Content-Type": "application/json",
    }


def submit_job(payload: dict) -> str:
    """RunPod에 분석 작업 제출. job_id 반환."""
    url = f"{RUNPOD_BASE_URL}/{RUNPOD_ENDPOINT_ID}/run"
    res = requests.post(url, json={"input": payload}, headers=_headers(), timeout=30)
    res.raise_for_status()
    job_id = res.json().get("id")
    logger.info(f"RunPod 작업 제출: job_id={job_id}")
    return job_id


def get_job_status(job_id: str) -> dict:
    """작업 상태 조회."""
    url = f"{RUNPOD_BASE_URL}/{RUNPOD_ENDPOINT_ID}/status/{job_id}"
    res = requests.get(url, headers=_headers(), timeout=30)
    res.raise_for_status()
    return res.json()


def cancel_job(job_id: str):
    """작업 취소."""
    url = f"{RUNPOD_BASE_URL}/{RUNPOD_ENDPOINT_ID}/cancel/{job_id}"
    try:
        requests.post(url, headers=_headers(), timeout=10)
        logger.info(f"RunPod 작업 취소: job_id={job_id}")
    except Exception as e:
        logger.warning(f"작업 취소 실패: {e}")


def run_analysis_on_runpod(
    match_id: int,
    video_url: str,
    home_color: str,
    away_color: str,
    referee_color: str,
    field_type: str = "soccer",
) -> dict:
    """
    RunPod에 분석 작업 제출 후 완료까지 대기.
    결과 반환.
    """
    if not RUNPOD_API_KEY or not RUNPOD_ENDPOINT_ID:
        raise ValueError("RUNPOD_API_KEY 또는 RUNPOD_ENDPOINT_ID 환경변수가 설정되지 않았습니다.")

    payload = {
        "match_id":      match_id,
        "video_url":     video_url,
        "home_color":    home_color,
        "away_color":    away_color,
        "referee_color": referee_color,
        "field_type":    field_type,
    }

    job_id = submit_job(payload)
    logger.info(f"RunPod 분석 시작: match_id={match_id}, job_id={job_id}")

    # 완료까지 폴링
    elapsed = 0
    while elapsed < MAX_WAIT_SEC:
        time.sleep(POLL_INTERVAL)
        elapsed += POLL_INTERVAL

        status = get_job_status(job_id)
        state = status.get("status", "").upper()

        logger.info(f"RunPod 상태: {state} (경과 {elapsed}초)")

        if state == "COMPLETED":
            output = status.get("output", {})
            if output.get("status") == "failed":
                raise ValueError(f"RunPod 분석 실패: {output.get('error')}")
            logger.info(f"RunPod 분석 완료: {output.get('player_count', 0)}명 감지")
            return output

        elif state in ("FAILED", "CANCELLED", "TIMED_OUT"):
            raise ValueError(f"RunPod 작업 실패: {state}")

        elif state == "IN_QUEUE":
            logger.info("GPU 서버 대기 중...")

        elif state == "IN_PROGRESS":
            logger.info("분석 진행 중...")

    # 타임아웃
    cancel_job(job_id)
    raise TimeoutError(f"RunPod 분석 타임아웃 ({MAX_WAIT_SEC}초)")
