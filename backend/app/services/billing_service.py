"""유료 기능 이용 권한과 토스페이먼츠 결제 확인.

토스 키(TOSS_CLIENT_KEY·TOSS_SECRET_KEY)가 없으면 결제는 꺼져 있고 모든 기능을 무료로 쓴다.
키를 넣으면 '프리미엄 기능'(고정밀 GPU 분석, AI 경기 요약·선수 분석)에 이용 권한이 필요하다.

권한이 생기는 경우 (아래 중 하나)
- 그 경기의 경기권을 결제했다
- 경기에 연결된 팀(홈·원정)의 팀 월 이용권이 30일 안에 결제됐다
- 팀의 첫 경기 무료 — 경기에 연결된 팀이 아직 무료 혜택을 쓰지 않았으면 그 경기에 쓴다

가격은 대표님이 정할 값이라 환경변수로 바꿀 수 있게 두었다 (기본값은 제안 가격).
"""

from __future__ import annotations

import base64
import os
from datetime import datetime, timedelta
from typing import Dict, Optional

import requests
from sqlalchemy.orm import Session

from app.models import Match, Payment

TOSS_CONFIRM = "https://api.tosspayments.com/v1/payments/confirm"
TEAM_PASS_DAYS = 30


def is_enabled() -> bool:
    return bool(os.environ.get("TOSS_CLIENT_KEY") and os.environ.get("TOSS_SECRET_KEY"))


def prices() -> Dict[str, int]:
    return {"match": int(os.environ.get("PRICE_MATCH", "3900")),
            "team_month": int(os.environ.get("PRICE_TEAM_MONTH", "19900"))}


PRODUCT_NAME = {"match": "경기권 (경기 1개 프리미엄 분석)", "team_month": "팀 월 이용권 (30일)"}


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


def confirm(payment_key: str, order_id: str, amount: int) -> Dict:
    """토스에 결제 승인을 요청한다. 실패하면 RuntimeError(토스 오류 메시지)."""
    secret = os.environ.get("TOSS_SECRET_KEY", "")
    auth = base64.b64encode(f"{secret}:".encode()).decode()
    r = requests.post(TOSS_CONFIRM, json={"paymentKey": payment_key, "orderId": order_id, "amount": amount},
                      headers={"Authorization": f"Basic {auth}", "Content-Type": "application/json"}, timeout=20)
    data = r.json() if r.content else {}
    if r.status_code != 200 or data.get("status") != "DONE":
        raise RuntimeError(data.get("message") or f"결제 승인 실패 ({r.status_code})")
    return data
