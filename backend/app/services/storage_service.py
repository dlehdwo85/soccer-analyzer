"""
Supabase Storage 연동 서비스
==============================
영상 파일을 Supabase Storage에 업로드하여 영구 보관.
Railway 재시작 시 파일 소실 문제 해결.
"""

import os
import logging
import requests

logger = logging.getLogger(__name__)

SUPABASE_URL     = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY     = os.environ.get("SUPABASE_KEY", "")
SUPABASE_BUCKET  = os.environ.get("SUPABASE_BUCKET", "soccer-videos")


def _headers():
    return {
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "apikey": SUPABASE_KEY,
    }


def upload_video(file_bytes: bytes, filename: str, match_id: int) -> str:
    """
    영상 파일을 Supabase Storage에 업로드.
    Returns: 공개 URL
    """
    if not SUPABASE_URL or not SUPABASE_KEY:
        logger.warning("Supabase 환경변수 미설정 → 로컬 저장 사용")
        return ""

    object_path = f"matches/{match_id}/{filename}"
    url = f"{SUPABASE_URL}/storage/v1/object/{SUPABASE_BUCKET}/{object_path}"

    headers = _headers()
    headers["Content-Type"] = "video/mp4"
    headers["x-upsert"] = "true"

    res = requests.post(url, data=file_bytes, headers=headers, timeout=300)
    res.raise_for_status()

    # 공개 URL 생성
    public_url = f"{SUPABASE_URL}/storage/v1/object/public/{SUPABASE_BUCKET}/{object_path}"
    logger.info(f"Supabase 업로드 완료: {public_url}")
    return public_url


def get_public_url(match_id: int, filename: str) -> str:
    """저장된 영상의 공개 URL 반환."""
    if not SUPABASE_URL:
        return ""
    object_path = f"matches/{match_id}/{filename}"
    return f"{SUPABASE_URL}/storage/v1/object/public/{SUPABASE_BUCKET}/{object_path}"


def delete_video(match_id: int, filename: str):
    """영상 파일 삭제."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        return
    object_path = f"matches/{match_id}/{filename}"
    url = f"{SUPABASE_URL}/storage/v1/object/{SUPABASE_BUCKET}/{object_path}"
    try:
        requests.delete(url, headers=_headers(), timeout=30)
        logger.info(f"Supabase 파일 삭제: {object_path}")
    except Exception as e:
        logger.warning(f"파일 삭제 실패: {e}")
