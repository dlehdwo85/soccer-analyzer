"""분석이 끝나면 카카오 알림톡으로 알려 준다 (솔라피 발송 대행).

필요한 것 (대표님 준비): 솔라피 가입·API 키, 카카오톡 비즈니스 채널을 솔라피에 연결(pfId), 알림톡 템플릿 승인,
발신번호 등록. 환경변수 SOLAPI_API_KEY·SOLAPI_API_SECRET·SOLAPI_PFID·SOLAPI_TEMPLATE_ID·SOLAPI_SENDER가 다 있어야 켜진다.

템플릿 변수: #{경기} (경기 제목), #{링크} (결과 페이지 주소). 템플릿 예시:
  [팬텀] #{경기} 경기 분석이 끝났습니다.
  선수별 기록과 하이라이트를 확인하세요.
  #{링크}
알림톡이 실패하면 같은 내용의 문자로 대신 보낸다 (솔라피 기본 동작).

전화번호는 알림을 보내면 바로 지운다 (보관하지 않는다).
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import os
import re
import secrets
from datetime import datetime, timezone
from typing import Optional

import requests

logger = logging.getLogger(__name__)

SOLAPI_SEND = "https://api.solapi.com/messages/v4/send"
_KEYS = ("SOLAPI_API_KEY", "SOLAPI_API_SECRET", "SOLAPI_PFID", "SOLAPI_TEMPLATE_ID", "SOLAPI_SENDER")


def is_configured() -> bool:
    return all(os.environ.get(k) for k in _KEYS)


def normalize_phone(v: Optional[str]) -> Optional[str]:
    """010-1234-5678 → 01012345678. 휴대폰 번호가 아니면 ValueError."""
    if v is None or not v.strip():
        return None
    digits = re.sub(r"\D", "", v)
    if not re.fullmatch(r"01[016789]\d{7,8}", digits):
        raise ValueError("휴대폰 번호 형식이 아닙니다 (예: 010-1234-5678)")
    return digits


def _auth_header() -> str:
    date = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    salt = secrets.token_hex(16)
    sig = hmac.new(os.environ["SOLAPI_API_SECRET"].encode(), (date + salt).encode(), hashlib.sha256).hexdigest()
    return f"HMAC-SHA256 apiKey={os.environ['SOLAPI_API_KEY']}, date={date}, salt={salt}, signature={sig}"


def result_url(match_id: int) -> str:
    site = (os.environ.get("SITE_URL") or (os.environ.get("ALLOWED_ORIGINS") or "").split(",")[0]).strip().rstrip("/")
    return f"{site}/matches/{match_id}/results"


def send_analysis_done(phone: str, match_id: int, title: str) -> bool:
    """알림톡 1건. 성공하면 True. 실패해도 예외를 내지 않는다 (분석 결과 저장이 우선)."""
    if not is_configured():
        return False
    link = result_url(match_id)
    body = {"message": {
        "to": phone, "from": os.environ["SOLAPI_SENDER"],
        "text": f"[팬텀] {title} 경기 분석이 끝났습니다.\n{link}",   # 알림톡 실패 시 문자 대체 발송 내용
        "kakaoOptions": {"pfId": os.environ["SOLAPI_PFID"], "templateId": os.environ["SOLAPI_TEMPLATE_ID"],
                         "variables": {"#{경기}": title[:50], "#{링크}": link}},
    }}
    try:
        r = requests.post(SOLAPI_SEND, json=body, headers={"Authorization": _auth_header()}, timeout=15)
        if r.status_code >= 300:
            logger.warning("알림톡 발송 실패 %s: %s", r.status_code, r.text[:200])
            return False
        return True
    except requests.RequestException as e:
        logger.warning("알림톡 발송 실패: %s", e)
        return False


def notify_if_requested(db, match) -> None:
    """분석이 끝난 경기에 알림 받을 번호가 있으면 보내고 번호를 지운다."""
    phone = getattr(match, "notify_phone", None)
    if not phone:
        return
    send_analysis_done(phone, match.id, match.title)
    match.notify_phone = None
    db.commit()
