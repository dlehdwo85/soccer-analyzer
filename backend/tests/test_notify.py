"""분석 완료 알림톡 — 번호 검증, 설정 없으면 저장하지 않음, 분석이 끝나면 한 번 보내고 번호를 지움."""

import os
import tempfile

import pytest

_tmp = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/test.db"
os.environ["UPLOAD_DIR"] = os.path.join(_tmp, "uploads")

from fastapi.testclient import TestClient  # noqa: E402

from app.database import SessionLocal  # noqa: E402
from app.models import Match  # noqa: E402
from app.services import notify_service  # noqa: E402
from main import app  # noqa: E402


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


def test_phone_normalize():
    assert notify_service.normalize_phone("010-1234-5678") == "01012345678"
    assert notify_service.normalize_phone(" ") is None
    with pytest.raises(ValueError):
        notify_service.normalize_phone("02-123-4567")


def test_sends_once_after_analysis_and_forgets_number(client, monkeypatch):
    sent = []
    for k in ("SOLAPI_API_KEY", "SOLAPI_API_SECRET", "SOLAPI_PFID", "SOLAPI_TEMPLATE_ID", "SOLAPI_SENDER"):
        monkeypatch.setenv(k, "x")
    monkeypatch.setattr(notify_service, "send_analysis_done", lambda phone, mid, title: sent.append((phone, mid, title)) or True)
    assert client.get("/api/notify/config").json() == {"alimtalk": True}
    mid = client.post("/api/matches", json={"title": "알림 경기"}).json()["id"]
    assert client.post(f"/api/matches/{mid}/analyze", json={"mode": "sample", "max_seconds": 120,
                                                            "notify_phone": "02-1"}).status_code == 422
    r = client.post(f"/api/matches/{mid}/analyze", json={"mode": "sample", "max_seconds": 120, "notify_phone": "010-1234-5678"})
    assert r.status_code == 200
    assert client.get(f"/api/matches/{mid}/status").json()["status"] == "done"
    assert sent == [("01012345678", mid, "알림 경기")]
    db = SessionLocal()
    try:
        assert db.get(Match, mid).notify_phone is None
    finally:
        db.close()


def test_number_not_kept_when_alimtalk_off(client, monkeypatch):
    monkeypatch.delenv("SOLAPI_API_KEY", raising=False)
    mid = client.post("/api/matches", json={"title": "알림 없음"}).json()["id"]
    client.post(f"/api/matches/{mid}/analyze", json={"mode": "sample", "max_seconds": 120, "notify_phone": "01012345678"})
    db = SessionLocal()
    try:
        assert db.get(Match, mid).notify_phone is None
    finally:
        db.close()
