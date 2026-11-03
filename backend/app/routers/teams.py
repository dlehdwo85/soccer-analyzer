"""팀·명단과 시즌 누적 기록.

팀을 등록해 두면 경기마다 홈/원정 팀으로 연결한다. 연결된 경기에서 이름을 붙인 선수(트랙)의 기록을 이름별로
모아 시즌 기록과 순위표를 만든다. 승패는 영상 점수 자막에서 읽은 골(meta.scoreboard)이 있는 경기만 센다.
"""

import json
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Match, Team
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


def _out(db: Session, t: Team) -> TeamOut:
    return TeamOut(id=t.id, name=t.name, color=t.color or "#56b4d3", roster=_roster(t),
                   match_count=_team_matches(db, t.id).count(), created_at=t.created_at)


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
def list_teams(db: Session = Depends(get_db)):
    return [_out(db, t) for t in db.query(Team).order_by(Team.name).all()]


@router.post("", response_model=TeamOut, status_code=201)
def create_team(body: TeamIn, db: Session = Depends(get_db)):
    t = Team()
    _save(t, body)
    db.add(t)
    db.commit()
    db.refresh(t)
    return _out(db, t)


@router.get("/{team_id}", response_model=TeamOut)
def get_team(team_id: int, db: Session = Depends(get_db)):
    return _out(db, _get(db, team_id))


@router.put("/{team_id}", response_model=TeamOut)
def update_team(team_id: int, body: TeamIn, db: Session = Depends(get_db)):
    t = _get(db, team_id)
    _save(t, body)
    db.commit()
    return _out(db, t)


@router.delete("/{team_id}", status_code=204)
def delete_team(team_id: int, db: Session = Depends(get_db)):
    """팀만 지우고 경기 기록은 남긴다 (경기의 팀 연결만 끊는다)."""
    t = _get(db, team_id)
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
