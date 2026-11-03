"""팀·명단과 시즌 누적 기록.

팀을 등록해 두면 경기마다 홈/원정 팀으로 연결한다. 연결된 경기에서 이름을 붙인 선수(트랙)의 기록을 이름별로
모아 시즌 기록과 순위표를 만든다. 승패는 영상 점수 자막에서 읽은 골(meta.scoreboard)이 있는 경기만 센다.

권한: 팀원이 한 명도 없는 팀(로그인 없이 만든 팀)은 누구나 고칠 수 있다. 팀원이 생기면 명단·팀 정보 수정은
운영진(owner·manager)만, 팀 삭제와 권한 변경은 팀장(owner)만 한다. 초대 링크로 들어온 사람은 팀원(member)이다.
"""

import json
import secrets
from typing import Dict, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Response
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Match, Team, TeamMember, User
from app.routers.auth import optional_user, require_user, user_out
from app.schemas import TeamIn, TeamOut
from app.services.result_service import CURRENT_VERSION, build_view

router = APIRouter(prefix="/api/teams", tags=["teams"])

SEASON_SUM = ("touches", "passes_attempted", "passes_completed", "key_passes", "forward_passes", "shots",
              "shots_on_target", "xg", "interceptions", "recoveries", "dispossessed", "seconds_tracked")


def _roster(t: Team) -> List[Dict]:
    try:
        return json.loads(t.roster_json or "[]")
    except ValueError:
        return []


def _team_matches(db: Session, team_id: int):
    return db.query(Match).filter(or_(Match.home_team_id == team_id, Match.away_team_id == team_id))


ROLES = ("owner", "manager", "member")
EDITORS = ("owner", "manager")


def _members(db: Session, team_id: int) -> List[TeamMember]:
    return db.query(TeamMember).filter(TeamMember.team_id == team_id).all()


def _role(db: Session, team_id: int, user: Optional[User]) -> Optional[str]:
    if user is None:
        return None
    m = db.query(TeamMember).filter(TeamMember.team_id == team_id, TeamMember.user_id == user.id).first()
    return m.role if m else None


def _require(db: Session, t: Team, user: Optional[User], roles=EDITORS) -> None:
    """팀원이 있는 팀이면 roles 권한이 있어야 한다."""
    if not _members(db, t.id):
        return
    if user is None:
        raise HTTPException(401, "이 팀을 고치려면 로그인이 필요합니다")
    if _role(db, t.id, user) not in roles:
        raise HTTPException(403, "이 팀을 고칠 권한이 없습니다" if roles == EDITORS else "팀장만 할 수 있습니다")


def _out(db: Session, t: Team, user: Optional[User] = None) -> TeamOut:
    members = _members(db, t.id)
    role = _role(db, t.id, user)
    return TeamOut(id=t.id, name=t.name, color=t.color or "#56b4d3", roster=_roster(t),
                   match_count=_team_matches(db, t.id).count(), created_at=t.created_at,
                   member_count=len(members), my_role=role, can_edit=not members or role in EDITORS)


def _get(db: Session, team_id: int) -> Team:
    t = db.get(Team, team_id)
    if not t:
        raise HTTPException(404, "팀을 찾을 수 없습니다")
    return t


def _save(t: Team, body: TeamIn) -> None:
    t.name = body.name.strip()
    t.color = body.color
    seen, roster = set(), []
    for r in body.roster:
        if r.name in seen:
            continue   # 같은 이름은 한 번만 (기록이 이름으로 모이므로)
        seen.add(r.name)
        roster.append(r.model_dump())
    t.roster_json = json.dumps(roster, ensure_ascii=False)


@router.get("", response_model=List[TeamOut])
def list_teams(db: Session = Depends(get_db), user: Optional[User] = Depends(optional_user)):
    return [_out(db, t, user) for t in db.query(Team).order_by(Team.name).all()]


@router.post("", response_model=TeamOut, status_code=201)
def create_team(body: TeamIn, db: Session = Depends(get_db), user: Optional[User] = Depends(optional_user)):
    t = Team()
    _save(t, body)
    db.add(t)
    db.flush()
    if user is not None:   # 로그인해서 만들면 만든 사람이 팀장
        db.add(TeamMember(team_id=t.id, user_id=user.id, role="owner"))
    db.commit()
    db.refresh(t)
    return _out(db, t, user)


@router.post("/join", response_model=TeamOut)
def join_team(code: str = Body(..., embed=True), db: Session = Depends(get_db), user: User = Depends(require_user)):
    """초대 링크로 팀에 들어간다. 팀원이 아무도 없던 팀이면 처음 들어온 사람이 팀장이 된다."""
    t = db.query(Team).filter(Team.invite_code == code.strip()).first() if code.strip() else None
    if not t:
        raise HTTPException(404, "초대 링크가 올바르지 않거나 바뀌었습니다. 팀 운영진에게 새 링크를 받으세요.")
    if _role(db, t.id, user) is None:
        db.add(TeamMember(team_id=t.id, user_id=user.id, role="member" if _members(db, t.id) else "owner"))
        db.commit()
    return _out(db, t, user)


@router.get("/{team_id}", response_model=TeamOut)
def get_team(team_id: int, db: Session = Depends(get_db), user: Optional[User] = Depends(optional_user)):
    return _out(db, _get(db, team_id), user)


@router.put("/{team_id}", response_model=TeamOut)
def update_team(team_id: int, body: TeamIn, db: Session = Depends(get_db), user: Optional[User] = Depends(optional_user)):
    t = _get(db, team_id)
    _require(db, t, user)
    _save(t, body)
    db.commit()
    return _out(db, t, user)


@router.get("/{team_id}/members")
def list_members(team_id: int, db: Session = Depends(get_db), user: Optional[User] = Depends(optional_user)):
    t = _get(db, team_id)
    rows = _members(db, t.id)
    role = _role(db, t.id, user)
    out = []
    for r in sorted(rows, key=lambda r: (ROLES.index(r.role) if r.role in ROLES else 9, r.created_at)):
        u = db.get(User, r.user_id)
        if u:
            out.append({**user_out(u), "role": r.role})
    can_invite = user is not None and (not rows or role in EDITORS)
    return {"members": out, "my_role": role, "invite_code": t.invite_code if can_invite else None}


@router.post("/{team_id}/invite")
def new_invite(team_id: int, db: Session = Depends(get_db), user: User = Depends(require_user)):
    """초대 링크 코드를 새로 만든다 (예전 링크는 더 이상 안 된다)."""
    t = _get(db, team_id)
    _require(db, t, user)
    t.invite_code = secrets.token_urlsafe(9)
    db.commit()
    return {"invite_code": t.invite_code}


def _owners(db: Session, team_id: int) -> int:
    return sum(r.role == "owner" for r in _members(db, team_id))


@router.patch("/{team_id}/members/{user_id}")
def set_role(team_id: int, user_id: int, role: str = Body(..., embed=True), db: Session = Depends(get_db),
             user: User = Depends(require_user)):
    t = _get(db, team_id)
    _require(db, t, user, roles=("owner",))
    if role not in ROLES:
        raise HTTPException(400, "권한은 owner·manager·member 중 하나입니다")
    m = db.query(TeamMember).filter(TeamMember.team_id == team_id, TeamMember.user_id == user_id).first()
    if not m:
        raise HTTPException(404, "팀원이 아닙니다")
    if m.role == "owner" and role != "owner" and _owners(db, team_id) <= 1:
        raise HTTPException(400, "팀장이 한 명은 있어야 합니다. 다른 사람을 먼저 팀장으로 지정하세요.")
    m.role = role
    db.commit()
    return {"ok": True}


@router.delete("/{team_id}/members/{user_id}", status_code=204)
def remove_member(team_id: int, user_id: int, db: Session = Depends(get_db), user: User = Depends(require_user)):
    """운영진이 팀원을 내보내거나, 본인이 팀을 나간다."""
    t = _get(db, team_id)
    if user_id != user.id:
        _require(db, t, user)
    m = db.query(TeamMember).filter(TeamMember.team_id == team_id, TeamMember.user_id == user_id).first()
    if not m:
        raise HTTPException(404, "팀원이 아닙니다")
    if m.role == "owner" and _owners(db, team_id) <= 1 and len(_members(db, team_id)) > 1:
        raise HTTPException(400, "팀장이 한 명은 있어야 합니다. 다른 사람을 먼저 팀장으로 지정하세요.")
    db.delete(m)
    db.commit()
    return Response(status_code=204)


@router.delete("/{team_id}", status_code=204)
def delete_team(team_id: int, db: Session = Depends(get_db), user: Optional[User] = Depends(optional_user)):
    """팀만 지우고 경기 기록은 남긴다 (경기의 팀 연결만 끊는다)."""
    t = _get(db, team_id)
    _require(db, t, user, roles=("owner",))
    for r in _members(db, team_id):
        db.delete(r)
    for m in _team_matches(db, team_id).all():
        if m.home_team_id == team_id:
            m.home_team_id = None
        if m.away_team_id == team_id:
            m.away_team_id = None
    db.delete(t)
    db.commit()
    return Response(status_code=204)


@router.get("/{team_id}/season")
def season(team_id: int, year: Optional[int] = Query(default=None, ge=2000, le=2100), db: Session = Depends(get_db)):
    """팀의 시즌 기록: 경기 목록·전적(점수 자막이 있는 경기만)·선수별 누적 기록."""
    t = _get(db, team_id)
    roster = {r["name"]: r.get("number") for r in _roster(t)}
    matches, players = [], {}
    record = {"played": 0, "scored_known": 0, "win": 0, "draw": 0, "loss": 0, "goals_for": 0, "goals_against": 0}
    for m in _team_matches(db, team_id).order_by(Match.date.desc(), Match.created_at.desc()).all():
        if year and not ((m.date or "").startswith(str(year)) or (not m.date and m.created_at.year == year)):
            continue
        if (m.analysis_version or 0) != CURRENT_VERSION:
            continue
        side = "home" if m.home_team_id == team_id else "away"
        opp = "away" if side == "home" else "home"
        view = build_view(db, m, include_events=False)
        record["played"] += 1
        board = (view.get("meta") or {}).get("scoreboard") or {}
        score = board.get("score") if board.get("found") else None
        item = {"match_id": m.id, "title": m.title, "date": m.date, "side": side,
                "opponent": m.away_team_name if side == "home" else m.home_team_name,
                "score": [score[side], score[opp]] if score else None,
                "possession_pct": (view["team_stats"].get(side) or {}).get("possession_pct")}
        matches.append(item)
        if score:
            gf, ga = score[side], score[opp]
            record["scored_known"] += 1
            record["goals_for"] += gf
            record["goals_against"] += ga
            record["win" if gf > ga else "draw" if gf == ga else "loss"] += 1

        name_of = {}
        for p in view["players"]:
            if p["team"] != side or p["excluded"] or not p["display_name"]:
                continue
            key = p["display_name"].strip()
            for tid in [p["track_id"], *p["merged_from"]]:
                name_of[tid] = key
            row = players.setdefault(key, {"name": key, "number": roster.get(key, p["jersey_number"]),
                                           "in_roster": key in roster, "matches": 0, "goals": 0,
                                           **{k: 0 for k in SEASON_SUM}})
            row["matches"] += 1
            for k in SEASON_SUM:
                row[k] += p["stats"].get(k) or 0
        for g in board.get("goals") or []:
            if g.get("team") == side and g.get("player") in name_of:
                players[name_of[g["player"]]]["goals"] += 1

    rows = []
    for r in players.values():
        r["minutes"] = round(r.pop("seconds_tracked") / 60, 1)
        r["xg"] = round(r["xg"], 2)
        r["pass_accuracy"] = round(r["passes_completed"] / r["passes_attempted"] * 100, 1) if r["passes_attempted"] else None
        rows.append(r)
    rows.sort(key=lambda r: (-r["matches"], -r["minutes"]))
    # 명단에 있지만 아직 기록이 없는 선수도 보여 준다
    for name, num in roster.items():
        if name not in players:
            rows.append({"name": name, "number": num, "in_roster": True, "matches": 0, "goals": 0, "minutes": 0,
                         "pass_accuracy": None, **{k: 0 for k in SEASON_SUM if k != "seconds_tracked"}})
    return {"team": _out(db, t).model_dump(mode="json"), "year": year, "record": record,
            "matches": matches, "players": rows}
