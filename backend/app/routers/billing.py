"""결제(토스페이먼츠)와 경기별 프리미엄 이용 권한."""

import json
import uuid
from datetime import datetime
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Match, Payment, Team, User
from app.routers.auth import optional_user
from app.services import billing_service

router = APIRouter(prefix="/api/billing", tags=["billing"])


class OrderIn(BaseModel):
    product: Literal["match", "team_month"]
    match_id: Optional[int] = None
    team_id: Optional[int] = None


class ConfirmIn(BaseModel):
    paymentKey: str
    orderId: str
    amount: int


def require_premium(db: Session, m: Match) -> None:
    """프리미엄 기능 앞에서 부른다. 결제가 꺼져 있으면 통과. 권한이 없으면 402."""
    if billing_service.access(db, m)["premium"]:
        return
    raise HTTPException(402, "프리미엄 기능입니다. 경기권이나 팀 월 이용권이 필요합니다 (팀의 첫 경기는 무료).")


@router.get("/config")
def config():
    import os
    return {"enabled": billing_service.is_enabled(),
            "client_key": os.environ.get("TOSS_CLIENT_KEY") if billing_service.is_enabled() else None,
            "prices": billing_service.prices(), "products": billing_service.PRODUCT_NAME}


@router.get("/matches/{match_id}/access")
def match_access(match_id: int, db: Session = Depends(get_db)):
    m = db.get(Match, match_id)
    if not m:
        raise HTTPException(404, "경기를 찾을 수 없습니다")
    return billing_service.access(db, m)


@router.post("/matches/{match_id}/trial")
def use_trial(match_id: int, db: Session = Depends(get_db)):
    """팀의 첫 경기 무료를 이 경기에 쓴다."""
    m = db.get(Match, match_id)
    if not m:
        raise HTTPException(404, "경기를 찾을 수 없습니다")
    if billing_service.access(db, m)["premium"]:
        return billing_service.access(db, m)
    if not billing_service.use_trial(db, m):
        raise HTTPException(400, "무료 혜택은 등록된 팀의 첫 경기에 한 번 쓸 수 있습니다. 경기 설정에서 팀을 연결하세요.")
    db.commit()
    return billing_service.access(db, m)


@router.post("/orders")
def create_order(body: OrderIn, db: Session = Depends(get_db), user: Optional[User] = Depends(optional_user)):
    if not billing_service.is_enabled():
        raise HTTPException(503, "결제가 아직 설정되지 않았습니다")
    if body.product == "match" and not (body.match_id and db.get(Match, body.match_id)):
        raise HTTPException(400, "경기권은 경기를 골라야 합니다")
    if body.product == "team_month" and not (body.team_id and db.get(Team, body.team_id)):
        raise HTTPException(400, "팀 월 이용권은 등록된 팀을 골라야 합니다")
    amount = billing_service.prices()[body.product]
    p = Payment(order_id=f"fa-{uuid.uuid4().hex[:24]}", user_id=user.id if user else None, product=body.product,
                match_id=body.match_id if body.product == "match" else None,
                team_id=body.team_id if body.product == "team_month" else None, amount=amount)
    db.add(p)
    db.commit()
    return {"order_id": p.order_id, "amount": amount, "order_name": billing_service.PRODUCT_NAME[body.product],
            "customer_key": f"user-{user.id}" if user else None}


@router.post("/confirm")
def confirm(body: ConfirmIn, db: Session = Depends(get_db)):
    """결제창 성공 페이지가 부른다. 금액이 주문과 같은지 확인하고 토스에 승인을 요청한다."""
    p = db.query(Payment).filter(Payment.order_id == body.orderId).first()
    if not p:
        raise HTTPException(404, "주문을 찾을 수 없습니다")
    if p.status == "done":
        return {"ok": True, "product": p.product, "match_id": p.match_id, "team_id": p.team_id}
    if body.amount != p.amount:
        raise HTTPException(400, "결제 금액이 주문과 다릅니다")
    try:
        data = billing_service.confirm(body.paymentKey, body.orderId, body.amount)
    except Exception as e:  # noqa: BLE001 — 토스 오류 메시지를 그대로 보여 준다
        p.status = "failed"
        db.commit()
        raise HTTPException(400, f"결제 승인 실패: {e}")
    p.status, p.payment_key, p.approved_at = "done", body.paymentKey, datetime.utcnow()
    p.raw_json = json.dumps({k: data.get(k) for k in ("method", "approvedAt", "totalAmount", "receipt")}, ensure_ascii=False)
    db.commit()
    return {"ok": True, "product": p.product, "match_id": p.match_id, "team_id": p.team_id}
