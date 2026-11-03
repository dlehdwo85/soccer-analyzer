"""카카오 로그인과 로그인 토큰.

카카오 개발자 앱의 REST API 키(KAKAO_REST_API_KEY)가 있어야 켜진다. 없으면 로그인 버튼이 보이지 않고
사이트는 지금처럼 로그인 없이 쓴다.

흐름: /api/auth/kakao/start → 카카오 동의 화면 → /api/auth/kakao/callback(code) → 토큰 교환·사용자 조회 →
우리 로그인 토큰을 만들어 사이트의 /auth/done#token=... 으로 돌려보낸다. 사이트는 토큰을 저장해
Authorization: Bearer 로 보낸다 (API와 사이트 도메인이 달라 쿠키 대신 토큰을 쓴다).

토큰: base64url(JSON {uid, exp}) + "." + HMAC-SHA256 서명. 서명 키는 AUTH_SECRET.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from typing import Dict, Optional
from urllib.parse import urlencode

import requests

KAKAO_AUTH = "https://kauth.kakao.com/oauth/authorize"
KAKAO_TOKEN = "https://kauth.kakao.com/oauth/token"
KAKAO_ME = "https://kapi.kakao.com/v2/user/me"
TOKEN_DAYS = 30


def kakao_key() -> Optional[str]:
    return os.environ.get("KAKAO_REST_API_KEY") or None


def is_configured() -> bool:
    return bool(kakao_key() and os.environ.get("AUTH_SECRET"))


def site_url() -> str:
    """로그인 뒤 돌아갈 사이트 주소. SITE_URL이 없으면 허용 출처(ALLOWED_ORIGINS)의 첫 번째."""
    url = os.environ.get("SITE_URL") or (os.environ.get("ALLOWED_ORIGINS") or "http://localhost:3000").split(",")[0]
    return url.strip().rstrip("/")


def redirect_uri(base_url: str = "") -> str:
    """카카오 앱에 등록하는 Redirect URI. KAKAO_REDIRECT_URI가 없으면 API 주소 + /api/auth/kakao/callback."""
    return os.environ.get("KAKAO_REDIRECT_URI") or f"{base_url.rstrip('/')}/api/auth/kakao/callback"


# ── 서명 ────────────────────────────────────────────────────────────────────

def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _sign(body: str) -> str:
    secret = os.environ.get("AUTH_SECRET", "").encode()
    return _b64(hmac.new(secret, body.encode(), hashlib.sha256).digest())


def make_token(payload: Dict, ttl_s: int = TOKEN_DAYS * 86400) -> str:
    body = _b64(json.dumps({**payload, "exp": int(time.time()) + ttl_s}, separators=(",", ":")).encode())
    return f"{body}.{_sign(body)}"


def read_token(token: Optional[str]) -> Optional[Dict]:
    """서명과 만료를 확인한 내용. 잘못됐으면 None."""
    if not token or "." not in token or not os.environ.get("AUTH_SECRET"):
        return None
    body, sig = token.rsplit(".", 1)
    if not hmac.compare_digest(sig, _sign(body)):
        return None
    try:
        data = json.loads(_unb64(body))
    except (ValueError, json.JSONDecodeError):
        return None
    return data if data.get("exp", 0) > time.time() else None


# ── 카카오 ──────────────────────────────────────────────────────────────────

def safe_next(path: Optional[str]) -> str:
    """로그인 뒤 돌아갈 사이트 안 경로 (다른 사이트로 보내는 주소는 버린다)."""
    p = (path or "/").strip()
    return p if p.startswith("/") and not p.startswith("//") else "/"


def authorize_url(next_path: str, base_url: str = "") -> str:
    state = make_token({"next": safe_next(next_path)}, ttl_s=600)
    q = {"client_id": kakao_key(), "redirect_uri": redirect_uri(base_url), "response_type": "code", "state": state}
    return f"{KAKAO_AUTH}?{urlencode(q)}"


def exchange_code(code: str, base_url: str = "") -> Dict:
    """인가 코드 → 카카오 사용자 {kakao_id, nickname, profile_image}."""
    data = {"grant_type": "authorization_code", "client_id": kakao_key(), "redirect_uri": redirect_uri(base_url), "code": code}
    if os.environ.get("KAKAO_CLIENT_SECRET"):
        data["client_secret"] = os.environ["KAKAO_CLIENT_SECRET"]
    tok = requests.post(KAKAO_TOKEN, data=data, timeout=15)
    if tok.status_code != 200:
        raise RuntimeError(f"카카오 토큰 교환 실패 ({tok.status_code}): {tok.text[:200]}")
    access = tok.json().get("access_token")
    me = requests.get(KAKAO_ME, headers={"Authorization": f"Bearer {access}"}, timeout=15)
    if me.status_code != 200:
        raise RuntimeError(f"카카오 사용자 정보 조회 실패 ({me.status_code})")
    info = me.json()
    profile = ((info.get("kakao_account") or {}).get("profile") or {})
    props = info.get("properties") or {}
    return {"kakao_id": str(info["id"]),
            "nickname": profile.get("nickname") or props.get("nickname"),
            "profile_image": profile.get("thumbnail_image_url") or props.get("thumbnail_image")}
