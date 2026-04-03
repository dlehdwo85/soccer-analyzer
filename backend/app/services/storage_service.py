"""
Cloudflare R2 Storage 연동 서비스
===================================
영상 파일을 Cloudflare R2에 업로드하여 영구 보관.
파일 크기 제한 없음 (1.21GB 영상도 가능).
"""

import os
import logging
import boto3
from botocore.config import Config

logger = logging.getLogger(__name__)

R2_ACCESS_KEY_ID     = os.environ.get("R2_ACCESS_KEY_ID", "")
R2_SECRET_ACCESS_KEY = os.environ.get("R2_SECRET_ACCESS_KEY", "")
R2_ENDPOINT          = os.environ.get("R2_ENDPOINT", "")
R2_BUCKET            = os.environ.get("R2_BUCKET", "soccer-videos")
R2_PUBLIC_URL        = os.environ.get("R2_PUBLIC_URL",
    "https://pub-91dfb4a599d6436991b7b6cea01a7a69.r2.dev")


def _get_client():
    """R2 S3 호환 클라이언트 생성."""
    return boto3.client(
        "s3",
        endpoint_url=R2_ENDPOINT,
        aws_access_key_id=R2_ACCESS_KEY_ID,
        aws_secret_access_key=R2_SECRET_ACCESS_KEY,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )


def upload_video(file_bytes: bytes, filename: str, match_id: int) -> str:
    """
    영상 파일을 Cloudflare R2에 업로드.
    Returns: 공개 URL
    """
    if not R2_ACCESS_KEY_ID or not R2_ENDPOINT:
        logger.warning("R2 환경변수 미설정 → 로컬 저장 사용")
        return ""

    object_key = f"matches/{match_id}/{filename}"

    try:
        client = _get_client()
        client.put_object(
            Bucket=R2_BUCKET,
            Key=object_key,
            Body=file_bytes,
            ContentType="video/mp4",
        )
        public_url = f"{R2_PUBLIC_URL}/{object_key}"
        logger.info(f"R2 업로드 완료: {public_url}")
        return public_url

    except Exception as e:
        logger.error(f"R2 업로드 실패: {e}")
        return ""


def get_public_url(match_id: int, filename: str) -> str:
    """저장된 영상의 공개 URL 반환."""
    return f"{R2_PUBLIC_URL}/matches/{match_id}/{filename}"


def get_presigned_upload_url(match_id: int, filename: str, expires_in: int = 3600) -> dict:
    """
    프론트엔드에서 직접 업로드할 수 있는 Presigned URL 생성.
    브라우저 → R2 직접 업로드 (Railway 용량 제한 우회).
    """
    if not R2_ACCESS_KEY_ID or not R2_ENDPOINT:
        return {}

    object_key = f"matches/{match_id}/{filename}"
    try:
        client = _get_client()
        presigned_url = client.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": R2_BUCKET,
                "Key": object_key,
                "ContentType": "video/mp4",
            },
            ExpiresIn=expires_in,
        )
        public_url = f"{R2_PUBLIC_URL}/{object_key}"
        return {
            "upload_url": presigned_url,
            "public_url": public_url,
            "object_key": object_key,
        }
    except Exception as e:
        logger.error(f"Presigned URL 생성 실패: {e}")
        return {}


def delete_video(match_id: int, filename: str):
    """영상 파일 삭제."""
    if not R2_ACCESS_KEY_ID or not R2_ENDPOINT:
        return
    object_key = f"matches/{match_id}/{filename}"
    try:
        client = _get_client()
        client.delete_object(Bucket=R2_BUCKET, Key=object_key)
        logger.info(f"R2 파일 삭제: {object_key}")
    except Exception as e:
        logger.warning(f"R2 파일 삭제 실패: {e}")
