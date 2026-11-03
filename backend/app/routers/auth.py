"""카카오 로그인 (설정이 없으면 꺼져 있고 사이트는 로그인 없이 동작)."""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Team, TeamMember, User
from app.services import auth_service

router = APIRouter(prefix="/api/auth", tags=["auth"])


def optional_user(authorization: Optional[str] = Header(default=None), db: Session = Depends(get_db)) -> Optional[User]:
    """로그인했으면 사용자, 아니면 None."""
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    data = auth_service.read_token(authorization.split(" ", 1)[1].strip())
    if not data or "uid" not in data:
        return None
    return db.get(User, int(data["uid"]))


def require_user(user: Optional[User] = Depends(optional_user)) -> User:
    if user is None:
        raise HTTPException(401, "로그인이 필요합니다")
    return user


def _base(request: Request) -> str:
    """API의 공개 주소 (Vercel 등 프록시 뒤에서도 https로)."""
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc
    return f"{proto}://{host}"


def user_out(u: User) -> dict:
    return {"id": u.id, "nickname": u.nickname, "profile_image": u.profile_image}


@router.get("/config")
def config(request: Request):
    """kakao: 로그인 켜짐 여부. redirect_uri: 카카오 개발자 앱에 등록할 주소 (설정 안내용)."""
    return {"kakao": auth_service.is_configured(), "redirect_uri": auth_service.redirect_uri(_base(request))}


@router.get("/kakao/start")
def kakao_start(request: Request, next: str = Query(default="/")):
    if not auth_service.is_configured():
        raise HTTPException(503, "카카오 로그인이 아직 설정되지 않았습니다")
    return RedirectResponse(auth_service.authorize_url(next, _base(request)), status_code=302)


@router.get("/kakao/callback")
def kakao_callback(request: Request, code: Optional[str] = None, state: Optional[str] = None,
                   error: Optional[str] = None, db: Session = Depends(get_db)):
    site = auth_service.site_url()
    st = auth_service.read_token(state) or {}
    nxt = auth_service.safe_next(st.get("next"))
    if error or not code or not st:
        return RedirectResponse(f"{site}/auth/done#error={error or 'state'}", status_code=302)
    try:
        info = auth_service.exchange_code(code, _base(request))
    except Exception:  # noqa: BLE001 — 사용자는 다시 시도하면 된다
        return RedirectResponse(f"{site}/auth/done#error=kakao", status_code=302)
    u = db.query(User).filter(User.kakao_id == info["kakao_id"]).first()
    if u is None:
        u = User(kakao_id=info["kakao_id"])
        db.add(u)
    u.nickname = info.get("nickname") or u.nickname
    u.profile_image = info.get("profile_image") or u.profile_image
    u.last_login_at = datetime.utcnow()
    db.commit()
    token = auth_service.make_token({"uid": u.id})
    return RedirectResponse(f"{site}/auth/done#token={token}&next={nxt}", status_code=302)


@router.get("/me")
def me(user: User = Depends(require_user), db: Session = Depends(get_db)):
    rows = db.query(TeamMember).filter(TeamMember.user_id == user.id).all()
    teams = []
    for r in rows:
        t = db.get(Team, r.team_id)
        if t:
            teams.append({"id": t.id, "name": t.name, "color": t.color, "role": r.role})
    return {**user_out(user), "teams": teams}
