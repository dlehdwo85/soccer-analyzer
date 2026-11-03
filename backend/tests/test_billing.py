"""결제 권한 — 결제 꺼짐(무료), 팀 첫 경기 무료, 경기권 결제 확인(토스 API는 가짜), 금액 위조 거부."""

import os
import tempfile

import pytest

_tmp = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/test.db"
os.environ["UPLOAD_DIR"] = os.path.join(_tmp, "uploads")

from fastapi.testclient import TestClient  # noqa: E402

from app.services import billing_service  # noqa: E402
from main import app  # noqa: E402


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def toss(monkeypatch):
    monkeypatch.setenv("TOSS_CLIENT_KEY", "test_ck_dummy")
    monkeypatch.setenv("TOSS_SECRET_KEY", "test_sk_dummy")
    calls = []

    def fake_confirm(key, order, amount):
        calls.append((key, order, amount))
        return {"status": "DONE", "method": "카드", "totalAmount": amount}
    monkeypatch.setattr(billing_service, "confirm", fake_confirm)
    return calls


def _match(client, **kw):
    return client.post("/api/matches", json={"title": "결제 경기", **kw}).json()["id"]


def test_everything_free_when_payments_off(client, monkeypatch):
    monkeypatch.delenv("TOSS_CLIENT_KEY", raising=False)
    mid = _match(client)
    assert client.get("/api/billing/config").json()["enabled"] is False
    assert client.get(f"/api/billing/matches/{mid}/access").json() == {"premium": True, "reason": "free", "trial_available": False}
    assert client.post("/api/billing/orders", json={"product": "match", "match_id": mid}).status_code == 503


def test_trial_then_match_pass(client, toss):
    tid = client.post("/api/teams", json={"name": "무료FC"}).json()["id"]
    m1, m2 = _match(client, home_team_id=tid), _match(client, home_team_id=tid)
    a = client.get(f"/api/billing/matches/{m1}/access").json()
    assert a["premium"] is False and a["trial_available"] is True
    assert client.post(f"/api/billing/matches/{m1}/trial").json()["reason"] == "trial"
    # 같은 팀의 두 번째 경기는 무료 혜택이 없다
    assert client.get(f"/api/billing/matches/{m2}/access").json()["trial_available"] is False
    assert client.post(f"/api/billing/matches/{m2}/trial").status_code == 400
    assert client.post(f"/api/matches/{m2}/ai-summary").status_code in (402, 409, 503)

    order = client.post("/api/billing/orders", json={"product": "match", "match_id": m2}).json()
    assert order["amount"] == billing_service.prices()["match"]
    bad = client.post("/api/billing/confirm", json={"paymentKey": "pk", "orderId": order["order_id"], "amount": 100})
    assert bad.status_code == 400 and not toss   # 금액이 다르면 토스에 승인 요청도 하지 않는다
    ok = client.post("/api/billing/confirm", json={"paymentKey": "pk", "orderId": order["order_id"], "amount": order["amount"]})
    assert ok.json()["ok"] and toss == [("pk", order["order_id"], order["amount"])]
    assert client.get(f"/api/billing/matches/{m2}/access").json()["reason"] == "match"
    # 같은 승인을 다시 보내도(새로고침) 한 번만 처리
    client.post("/api/billing/confirm", json={"paymentKey": "pk", "orderId": order["order_id"], "amount": order["amount"]})
    assert len(toss) == 1


def test_team_month_pass_covers_all_team_matches(client, toss):
    tid = client.post("/api/teams", json={"name": "구독FC"}).json()["id"]
    order = client.post("/api/billing/orders", json={"product": "team_month", "team_id": tid}).json()
    client.post("/api/billing/confirm", json={"paymentKey": "pk2", "orderId": order["order_id"], "amount": order["amount"]})
    mid = _match(client, away_team_id=tid)
    assert client.get(f"/api/billing/matches/{mid}/access").json()["reason"] == "team"
    assert client.post("/api/billing/orders", json={"product": "team_month"}).status_code == 400
