"""RunPod Serverless 연동 — 워커(backend/worker_handler.py)에 분석을 맡기고 결과를 받는다.

서버리스 백엔드(Vercel 함수)는 몇 분 안에 끝나야 하므로 분석이 끝날 때까지 기다리지 않는다.
  submit_job()   : 작업을 제출하고 job id를 돌려준다 (경기에 저장)
  check_job()    : 상태 조회 때마다 RunPod에 한 번 물어보고, 끝났으면 결과를 가져온다
결과는 워커가 R2(results/...)에 올리고, 여기서는 그 객체를 내려받는다. 워커에 R2가 없으면 응답에 실린 결과를 쓴다.
"""

import gzip
import json
import logging
import os
import time
from typing import Callable, Dict, Optional

import requests

from app.vision.pipeline import unpack_result

logger = logging.getLogger(__name__)

RUNPOD_BASE_URL = "https://api.runpod.ai/v2"
MAX_WAIT_SEC = int(os.environ.get("RUNPOD_MAX_WAIT_SEC", "5400"))  # 동기 대기(로컬 서버 전용)
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


def submit_job(video_url: str, config: Dict, result_key: Optional[str] = None) -> str:
    if not is_configured():
        raise RuntimeError("RUNPOD_API_KEY / RUNPOD_ENDPOINT_ID 환경변수가 설정되지 않았습니다.")
    inp = {"video_url": video_url, "config": config}
    if result_key:
        inp["result_key"] = result_key
    res = requests.post(_url("run"), json={"input": inp}, headers=_headers(), timeout=30)
    res.raise_for_status()
    job_id = res.json().get("id")
    if not job_id:
        raise RuntimeError("RunPod가 작업 번호를 돌려주지 않았습니다.")
    logger.info("RunPod 작업 제출: %s", job_id)
    return job_id


def _download_result(key: str) -> Dict:
    """워커가 R2에 올린 결과(gzip JSON)를 내려받는다. 백엔드에 R2 키가 있으면 S3 API, 없으면 공개 주소."""
    ep, ak, sk = os.environ.get("R2_ENDPOINT"), os.environ.get("R2_ACCESS_KEY_ID"), os.environ.get("R2_SECRET_ACCESS_KEY")
    if ep and ak and sk:
        import boto3
        s3 = boto3.client("s3", endpoint_url=ep, region_name="auto", aws_access_key_id=ak, aws_secret_access_key=sk)
        raw = s3.get_object(Bucket=os.environ.get("R2_BUCKET", "soccer-videos"), Key=key)["Body"].read()
    else:
        base = os.environ.get("R2_PUBLIC_URL", "").rstrip("/")
        if not base:
            raise RuntimeError("결과를 내려받을 R2 설정(R2_ENDPOINT 등 또는 R2_PUBLIC_URL)이 없습니다.")
        r = requests.get(f"{base}/{key}", timeout=60)
        r.raise_for_status()
        raw = r.content
    try:
        raw = gzip.decompress(raw)
    except OSError:
        pass  # 이미 풀려서 왔다(Content-Encoding: gzip을 클라이언트가 풀었다)
    return json.loads(raw)


def _result_from_output(out) -> Dict:
    if not isinstance(out, dict):
        raise RuntimeError("RunPod 응답 형식이 올바르지 않습니다.")
    if out.get("status") == "failed":
        raise RuntimeError(f"영상 분석 실패: {out.get('error')}")
    if out.get("result_key"):
        return _download_result(out["result_key"])
    if "result_gz" in out:
        return unpack_result(out["result_gz"])
    raise RuntimeError("이전 버전 워커의 응답입니다. backend/Dockerfile.worker로 워커 이미지를 다시 배포하세요.")


def check_job(job_id: str) -> Dict:
    """RunPod에 한 번 물어본다. 반환: {state, percent, message, result?, error?}
    state: queued | running | done | failed"""
    try:
        st = requests.get(_url(f"status/{job_id}"), headers=_headers(), timeout=20).json()
    except (requests.RequestException, ValueError) as e:
        logger.warning("RunPod 상태 조회 실패: %s", e)
        return {"state": "running", "percent": None, "message": "GPU 서버 응답 대기 중"}
    if not isinstance(st, dict) or not isinstance(st.get("status"), str):
        # 취소됐거나 대기 기한(24시간)이 지나 지워진 작업은 {"status": 404, "error": ...}처럼 숫자로 온다
        err = st.get("error") if isinstance(st, dict) else None
        return {"state": "failed", "error": f"GPU 작업을 찾을 수 없습니다(취소되었거나 대기 기한이 지남). 다시 분석해 주세요. {err or ''}".strip()}
    state = st["status"].upper()
    out = st.get("output")
    if state == "COMPLETED":
        try:
            return {"state": "done", "result": _result_from_output(out)}
        except Exception as e:  # noqa: BLE001 — 사용자에게 보여 줄 실패
            return {"state": "failed", "error": str(e)}
    if state in ("FAILED", "CANCELLED", "TIMED_OUT"):
        return {"state": "failed", "error": f"RunPod 작업 실패: {state} {st.get('error') or ''}".strip()}
    if state == "IN_QUEUE":
        return {"state": "queued", "percent": 3.0, "message": "GPU 서버 대기 중"}
    if isinstance(out, dict) and "percent" in out:
        return {"state": "running", "percent": float(out["percent"]), "message": out.get("message") or "분석 중"}
    return {"state": "running", "percent": None, "message": "GPU 서버에서 분석 중"}


def run_analysis_on_runpod(video_url: str, config: Dict,
                           progress: Optional[Callable[[float, str], None]] = None,
                           result_key: Optional[str] = None) -> Dict:
    """작업 제출 → 완료까지 기다림 → 결과 반환. 오래 살아 있는 서버(로컬·Docker)에서만 쓴다."""
    progress = progress or (lambda p, m: None)
    job_id = submit_job(video_url, config, result_key)
    progress(2, "GPU 서버 준비 중")
    started = time.time()
    while time.time() - started < MAX_WAIT_SEC:
        time.sleep(POLL_INTERVAL)
        st = check_job(job_id)
        if st["state"] == "done":
            return st["result"]
        if st["state"] == "failed":
            raise RuntimeError(st["error"])
        if st.get("percent") is not None:
            progress(st["percent"], st.get("message") or "분석 중")
    cancel_job(job_id)
    raise TimeoutError(f"RunPod 분석 타임아웃 ({MAX_WAIT_SEC}초)")
