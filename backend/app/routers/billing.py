"""결제(나이스페이)와 경기별 프리미엄 이용 권한."""

import json
import uuid
from datetime import datetime
from typing import Literal, Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Match, Payment, Team, User
from app.routers.auth import _base, optional_user
from app.services import auth_service, billing_service

router = APIRouter(prefix="/api/billing", tags=["billing"])


class OrderIn(BaseModel):
    product: Literal["match", "team_month"]
    match_id: Optional[int] = None
    team_id: Optional[int] = None
    back: Optional[str] = None     # 결제 뒤 돌아갈 사이트 경로


def require_premium(db: Session, m: Match) -> None:
    """프리미엄 기능 앞에서 부른다. 결제가 꺼져 있으면 통과. 권한이 없으면 402."""
    if billing_service.access(db, m)["premium"]:
        return
    raise HTTPException(402, "프리미엄 기능입니다. 경기권이나 팀 월 이용권이 필요합니다 (팀의 첫 경기는 무료).")


@router.get("/config")
def config():
    return {"enabled": billing_service.is_enabled(), "mode": billing_service.conf()["mode"],
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
def create_order(body: OrderIn, request: Request, db: Session = Depends(get_db),
                 user: Optional[User] = Depends(optional_user)):
    """주문을 만들고 나이스페이 결제창 파라미터를 돌려준다 (금액·서명은 서버가 정한다)."""
    if not billing_service.is_enabled():
        raise HTTPException(503, "결제가 아직 열리지 않았습니다")
    if body.product == "match" and not (body.match_id and db.get(Match, body.match_id)):
        raise HTTPException(400, "경기권은 경기를 골라야 합니다")
    if body.product == "team_month" and not (body.team_id and db.get(Team, body.team_id)):
        raise HTTPException(400, "팀 월 이용권은 등록된 팀을 골라야 합니다")
    amount = billing_service.prices()[body.product]
    name = billing_service.PRODUCT_NAME[body.product]
    p = Payment(order_id=f"ph{uuid.uuid4().hex[:22]}", user_id=user.id if user else None, product=body.product,
                match_id=body.match_id if body.product == "match" else None,
                team_id=body.team_id if body.product == "team_month" else None, amount=amount,
                return_path=auth_service.safe_next(body.back), pg_mode=billing_service.conf()["mode"])
    db.add(p)
    db.commit()
    params = billing_service.window_params(p.order_id, amount, name, f"{_base(request)}/api/billing/nicepay/return")
    return {"order_id": p.order_id, "amount": amount, "order_name": name, "mode": p.pg_mode,
            "script": billing_service.SCRIPT, "params": params}


@router.post("/nicepay/return")
async def nicepay_return(request: Request, db: Session = Depends(get_db)):
    """나이스페이 결제창이 인증 결과를 POST하는 곳 → 승인 → 사이트의 결과 화면으로."""
    site = auth_service.site_url()
    a = billing_service.parse_nice_form(await request.body())
    p = db.query(Payment).filter(Payment.order_id == a.get("Moid", "")).first()
    if not p:
        return RedirectResponse(f"{site}/billing/fail?message={quote('주문을 찾을 수 없습니다')}", status_code=303)
    back = quote(p.return_path or "/")
    if p.status == "done":   # 새로고침·중복 제출
        return RedirectResponse(f"{site}/billing/success?back={back}", status_code=303)
    if p.status != "pending":
        return RedirectResponse(f"{site}/billing/fail?back={back}&message={quote('처리할 수 없는 주문입니다')}", status_code=303)
    r = billing_service.approve_auth(a, p.amount)
    p.payment_key = r.get("tid") or a.get("TxTid")
    p.raw_json = json.dumps({"code": r.get("code"), "msg": r.get("msg"), "card": r.get("card"), "mode": p.pg_mode},
                            ensure_ascii=False)
    if r["ok"]:
        p.status, p.approved_at = "done", datetime.utcnow()
        db.commit()
        return RedirectResponse(f"{site}/billing/success?back={back}", status_code=303)
    p.status = "failed"
    db.commit()
    code = quote(str(r.get("code") or ""))
    return RedirectResponse(f"{site}/billing/fail?back={back}&code={code}&message={quote(r.get('msg') or '결제 실패')}",
                            status_code=303)
