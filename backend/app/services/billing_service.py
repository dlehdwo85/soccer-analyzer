"""유료 기능 이용 권한과 나이스페이(NICEPAY) 결제 — 워크인과 같은 방식(웹표준 결제창 + 인증 응답 → 승인).

결제는 PAYMENTS_ENABLED=1 일 때만 켜진다. 꺼져 있으면 모든 기능을 무료로 쓴다 (지금과 같음).
상점: NICEPAY_MODE=live 이고 NICEPAY_PAY_MID·NICEPAY_PAY_KEY가 있으면 실 상점, 아니면 나이스페이 공개 시험 상점
(nictest00m — 실제로 청구되지 않고 당일 자동 취소). 실 상점 키는 저장소에 쓰지 않고 대표님이 Vercel에 넣는다.

흐름: 주문 생성(금액은 서버가 정함) → 브라우저가 나이스페이 결제창(goPay) → 나이스페이가 인증 결과를
/api/billing/nicepay/return 으로 POST → 서명·금액 확인 → NextAppURL 로 승인 요청 → 결제 완료.

권한이 생기는 경우 (아래 중 하나)
- 그 경기의 경기권을 결제했다
- 경기에 연결된 팀(홈·원정)의 팀 월 이용권이 30일 안에 결제됐다
- 팀의 첫 경기 무료 — 경기에 연결된 팀이 아직 무료 혜택을 쓰지 않았으면 그 경기에 쓴다
가격은 대표님이 정할 값이라 환경변수로 바꿀 수 있게 두었다 (기본값은 제안 가격).
"""

from __future__ import annotations

import hashlib
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Dict, Optional
from urllib.parse import unquote_to_bytes

import requests
from sqlalchemy.orm import Session

from app.models import Match, Payment

TEAM_PASS_DAYS = 30
SCRIPT = "https://pg-web.nicepay.co.kr/v3/common/js/nicepay-pgweb.js"
# 나이스페이 공개 시험 상점 (개발자 문서에 공개된 값 — 실제 청구 없음)
PUBLIC_TEST_MID = "nictest00m"
PUBLIC_TEST_KEY = "EYzu8jGGMfqaDEp76gSckuvnaHHu+bC4opsSN6lHv3b2lurNYkVXrZ7Z1AoqQnXI3eLuaUFyoRNC6FkrzVjceg=="
NICE_HOST = re.compile(r"^https://(dc1-api|dc2-api|pg-api|webapi)\.nicepay\.co\.kr/")


def is_enabled() -> bool:
    return os.environ.get("PAYMENTS_ENABLED") == "1"


def conf() -> Dict[str, str]:
    """{mode, mid, key}. 실 상점은 NICEPAY_MODE=live + 키가 있을 때만."""
    mid, key = os.environ.get("NICEPAY_PAY_MID"), os.environ.get("NICEPAY_PAY_KEY")
    if os.environ.get("NICEPAY_MODE") == "live" and mid and key:
        return {"mode": "live", "mid": mid, "key": key}
    return {"mode": "test", "mid": os.environ.get("NICEPAY_TEST_PAY_MID") or PUBLIC_TEST_MID,
            "key": os.environ.get("NICEPAY_TEST_PAY_KEY") or PUBLIC_TEST_KEY}


def prices() -> Dict[str, int]:
    return {"match": int(os.environ.get("PRICE_MATCH", "3900")),
            "team_month": int(os.environ.get("PRICE_TEAM_MONTH", "19900"))}


PRODUCT_NAME = {"match": "팬텀 경기권 (경기 1개 프리미엄 분석)", "team_month": "팬텀 팀 월 이용권 (30일)"}


def _sha(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def edi_date(now: Optional[datetime] = None) -> str:
    """YYYYMMDDHHMISS (서울)"""
    now = now or datetime.now(timezone.utc)
    return (now + timedelta(hours=9)).strftime("%Y%m%d%H%M%S")


def window_params(order_id: str, amount: int, goods_name: str, return_url: str) -> Dict[str, str]:
    """결제창(goPay) 파라미터. SignData는 서버에서만 만든다."""
    c = conf()
    edi = edi_date()
    return {"PayMethod": "CARD", "GoodsName": goods_name, "Amt": str(amount), "MID": c["mid"], "Moid": order_id,
            "EdiDate": edi, "SignData": _sha(edi + c["mid"] + str(amount) + c["key"]), "ReturnURL": return_url,
            "CharSet": "utf-8"}


def parse_nice_form(raw: bytes) -> Dict[str, str]:
    """나이스페이가 보내는 form (UTF-8 또는 EUC-KR 퍼센트 인코딩)."""
    out: Dict[str, str] = {}
    for part in raw.split(b"&"):
        if not part:
            continue
        k, _, v = part.partition(b"=")

        def dec(b: bytes) -> str:
            data = unquote_to_bytes(b.replace(b"+", b" "))
            try:
                return data.decode("utf-8")
            except UnicodeDecodeError:
                return data.decode("euc-kr", errors="replace")
        out[dec(k)] = dec(v)
    return out


def approve_auth(a: Dict[str, str], expect_amount: int) -> Dict:
    """인증 응답 → 승인. {ok, code, msg, tid}. 인증 서명·금액·승인 주소를 확인한다."""
    c = conf()
    if a.get("AuthResultCode") != "0000":
        return {"ok": False, "code": a.get("AuthResultCode"), "msg": a.get("AuthResultMsg") or "인증에 실패했습니다"}
    if a.get("Signature") != _sha(a.get("AuthToken", "") + c["mid"] + a.get("Amt", "") + c["key"]):
        return {"ok": False, "code": "SIGN", "msg": "인증 응답 위변조 검증 실패"}
    if int(a.get("Amt") or 0) != expect_amount:
        return {"ok": False, "code": "AMT", "msg": "금액이 주문과 다릅니다"}
    nxt = a.get("NextAppURL", "")
    if not NICE_HOST.match(nxt):
        return {"ok": False, "code": "URL", "msg": "승인 주소가 올바르지 않습니다"}
    edi = edi_date()
    body = {"TID": a.get("TxTid", ""), "AuthToken": a.get("AuthToken", ""), "MID": c["mid"], "Amt": a.get("Amt", ""),
            "EdiDate": edi, "SignData": _sha(a.get("AuthToken", "") + c["mid"] + a.get("Amt", "") + edi + c["key"]),
            "CharSet": "utf-8", "EdiType": "JSON"}
    try:
        r = requests.post(nxt, data=body, timeout=30).json()
    except (requests.RequestException, ValueError) as e:
        return {"ok": False, "code": "HTTP", "msg": f"승인 요청 실패: {e}"}
    sig_ok = not r.get("Signature") or r["Signature"] == _sha((r.get("TID") or "") + c["mid"] + (r.get("Amt") or "") + c["key"])
    ok = r.get("ResultCode") == "3001" and sig_ok and int(r.get("Amt") or 0) == expect_amount
    return {"ok": ok, "code": r.get("ResultCode"), "msg": r.get("ResultMsg") if sig_ok else "승인 응답 위변조 검증 실패",
            "tid": r.get("TID") or a.get("TxTid"), "card": r.get("CardName")}


def _team_pass_active(db: Session, team_id: Optional[int]) -> bool:
    if not team_id:
        return False
    since = datetime.utcnow() - timedelta(days=TEAM_PASS_DAYS)
    return db.query(Payment).filter(Payment.product == "team_month", Payment.team_id == team_id,
                                    Payment.status == "done", Payment.approved_at >= since).first() is not None


def _trial_used(db: Session, team_id: int) -> bool:
    return db.query(Match).filter(Match.free_trial.is_(True),
                                  (Match.home_team_id == team_id) | (Match.away_team_id == team_id)).first() is not None


def access(db: Session, m: Match) -> Dict:
    """{premium, reason, trial_available}. reason: free(결제 꺼짐) | match | team | trial"""
    if not is_enabled():
        return {"premium": True, "reason": "free", "trial_available": False}
    if m.free_trial:
        return {"premium": True, "reason": "trial", "trial_available": False}
    if db.query(Payment).filter(Payment.product == "match", Payment.match_id == m.id,
                                Payment.status == "done").first():
        return {"premium": True, "reason": "match", "trial_available": False}
    for tid in (m.home_team_id, m.away_team_id):
        if _team_pass_active(db, tid):
            return {"premium": True, "reason": "team", "trial_available": False}
    trial = any(tid and not _trial_used(db, tid) for tid in (m.home_team_id, m.away_team_id))
    return {"premium": False, "reason": None, "trial_available": bool(trial)}


def use_trial(db: Session, m: Match) -> bool:
    """팀의 첫 경기 무료를 이 경기에 쓴다. 쓸 수 있으면 True."""
    if any(tid and not _trial_used(db, tid) for tid in (m.home_team_id, m.away_team_id)):
        m.free_trial = True
        return True
    return False
