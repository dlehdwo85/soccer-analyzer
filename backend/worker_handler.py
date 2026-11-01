"""RunPod Serverless 워커 — GPU에서 영상 분석을 실행한다.

배포: backend/Dockerfile.worker 로 이미지를 빌드해 RunPod Serverless 엔드포인트에 올린다.
백엔드(Railway)는 runpod_service가 이 워커에 작업을 보내고 결과를 받아 DB에 저장한다.

입력 (job["input"])
  video_url : 영상 URL (R2 공개 URL 등)
  config    : AnalysisConfig 필드 (팀 색, 보정, 공격 방향 등)
출력
  {"status": "done", "result_gz": <gzip+base64 JSON>}  또는  {"status": "failed", "error": "..."}
"""

import logging
import os
import tempfile

import requests
import runpod

from app.vision.pipeline import AnalysisConfig, analyze_video, pack_result

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("worker")


def _download(url: str, dest: str) -> None:
    with requests.get(url, stream=True, timeout=60) as r:
        r.raise_for_status()
        with open(dest, "wb") as f:
            for chunk in r.iter_content(chunk_size=8 * 1024 * 1024):
                f.write(chunk)


def handler(job):
    inp = job.get("input") or {}
    url = inp.get("video_url")
    if not url:
        return {"status": "failed", "error": "video_url이 없습니다"}
    cfg = AnalysisConfig.from_dict(inp.get("config") or {})

    def progress(pct: float, msg: str):
        try:
            runpod.serverless.progress_update(job, {"percent": round(pct, 1), "message": msg})
        except Exception:  # 진행률 보고 실패는 분석을 막지 않는다
            pass

    fd, path = tempfile.mkstemp(suffix=os.path.splitext(url.split("?")[0])[1] or ".mp4")
    os.close(fd)
    try:
        progress(1, "영상 내려받는 중")
        _download(url, path)
        result = analyze_video(path, cfg, progress=progress)
        logger.info("분석 완료: 선수 %d명, 이벤트 %d개", len(result["players"]), len(result["events"]))
        return {"status": "done", "result_gz": pack_result(result)}
    except Exception as e:
        logger.exception("분석 실패")
        return {"status": "failed", "error": str(e)}
    finally:
        try:
            os.remove(path)
        except OSError:
            pass


if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})
