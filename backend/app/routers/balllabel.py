"""공 위치 표시(공 모델 추가 학습 데이터). 묶음 번호를 아는 사람만 쓸 수 있다(주소로만 공유)."""

import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import BallLabel, BallLabelSet

router = APIRouter(prefix="/api/balllabel", tags=["balllabel"])


class LabelIn(BaseModel):
    visible: bool
    x: Optional[float] = None
    y: Optional[float] = None


def _set(db: Session, set_id: str) -> BallLabelSet:
    s = db.get(BallLabelSet, set_id)
    if s is None:
        raise HTTPException(404, "표시할 장면 묶음이 없습니다")
    return s


@router.get("/{set_id}")
def get_set(set_id: str, db: Session = Depends(get_db)):
    s = _set(db, set_id)
    labels = {r.image: {"visible": bool(r.visible), "x": r.x, "y": r.y}
              for r in db.query(BallLabel).filter(BallLabel.set_id == set_id).all()}
    return {"id": s.id, "title": s.title, **json.loads(s.manifest_json), "labels": labels}


@router.put("/{set_id}/{image}")
def put_label(set_id: str, image: str, body: LabelIn, db: Session = Depends(get_db)):
    s = _set(db, set_id)
    frames = {f["name"]: f for f in json.loads(s.manifest_json)["frames"]}
    f = frames.get(image)
    if f is None:
        raise HTTPException(404, "묶음에 없는 장면입니다")
    if body.visible and (body.x is None or body.y is None or not (0 <= body.x <= f["w"] and 0 <= body.y <= f["h"])):
        raise HTTPException(400, "공 위치가 화면 밖입니다")
    r = db.query(BallLabel).filter(BallLabel.set_id == set_id, BallLabel.image == image).first()
    if r is None:
        r = BallLabel(set_id=set_id, image=image)
        db.add(r)
    r.visible = body.visible
    r.x, r.y = (body.x, body.y) if body.visible else (None, None)
    db.commit()
    return {"ok": True}


@router.delete("/{set_id}/{image}")
def clear_label(set_id: str, image: str, db: Session = Depends(get_db)):
    _set(db, set_id)
    db.query(BallLabel).filter(BallLabel.set_id == set_id, BallLabel.image == image).delete()
    db.commit()
    return {"ok": True}
