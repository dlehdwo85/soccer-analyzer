"""결제 권한 — 결제 꺼짐(무료), 팀 첫 경기 무료, 나이스페이 결제창 인증 → 승인(나이스페이는 가짜), 위변조 거부."""

import hashlib
import os
import tempfile
from urllib.parse import parse_qs, urlencode, urlparse

import pytest

_tmp = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/test.db"
os.environ["UPLOAD_DIR"] = os.path.join(_tmp, "uploads")

from fastapi.testclient import TestClient  # noqa: E402

from app.services import billing_service  # noqa: E402
from main import app  # noqa: E402

sha = lambda s: hashlib.sha256(s.encode()).hexdigest()  # noqa: E731


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def pay(monkeypatch):
    monkeypatch.setenv("PAYMENTS_ENABLED", "1")
    monkeypatch.setenv("SITE_URL", "https://site.example.test")
    calls = []

    class Resp:
        def __init__(self, d): self.d = d
        def json(self): return self.d

    def fake_post(url, data=None, timeout=None):
        calls.append((url, data))
        c = billing_service.conf()
        return Resp({"ResultCode": "3001", "ResultMsg": "카드 결제 성공", "TID": data["TID"], "Amt": data["Amt"],
                     "Signature": sha(data["TID"] + c["mid"] + data["Amt"] + c["key"]), "CardName": "시험카드"})
    monkeypatch.setattr(billing_service.requests, "post", fake_post)
    return calls


def _auth_form(order, amount=None, tamper=False):
    """나이스페이 결제창이 돌려주는 인증 응답 (공개 시험 상점 키로 서명)."""
    c = billing_service.conf()
    amt = str(amount if amount is not None else order["amount"])
    token = "AUTHTOKEN123"
    return urlencode({"AuthResultCode": "0000", "AuthResultMsg": "인증 성공", "AuthToken": token, "Amt": amt,
                      "Moid": order["order_id"], "TxTid": "nictest00m01011234", "MID": c["mid"],
                      "NextAppURL": "https://dc1-api.nicepay.co.kr/webapi/pay_process.jsp",
                      "Signature": sha(token + c["mid"] + amt + c["key"]) + ("x" if tamper else "")})


def _match(client, **kw):
    return client.post("/api/matches", json={"title": "결제 경기", **kw}).json()["id"]


def _return(client, form):
    r = client.post("/api/billing/nicepay/return", content=form,
                    headers={"Content-Type": "application/x-www-form-urlencoded"}, follow_redirects=False)
    assert r.status_code == 303
    return r.headers["location"]


def test_everything_free_when_payments_off(client, monkeypatch):
    monkeypatch.delenv("PAYMENTS_ENABLED", raising=False)
    mid = _match(client)
    cfg = client.get("/api/billing/config").json()
    assert cfg["enabled"] is False and cfg["mode"] == "test"
    assert client.get(f"/api/billing/matches/{mid}/access").json() == {"premium": True, "reason": "free", "trial_available": False}
    assert client.post("/api/billing/orders", json={"product": "match", "match_id": mid}).status_code == 503


def test_trial_then_match_pass_via_nicepay(client, pay):
    tid = client.post("/api/teams", json={"name": "무료FC"}).json()["id"]
    m1, m2 = _match(client, home_team_id=tid), _match(client, home_team_id=tid)
    assert client.get(f"/api/billing/matches/{m1}/access").json()["trial_available"] is True
    assert client.post(f"/api/billing/matches/{m1}/trial").json()["reason"] == "trial"
    assert client.post(f"/api/billing/matches/{m2}/trial").status_code == 400

    order = client.post("/api/billing/orders", json={"product": "match", "match_id": m2, "back": f"/matches/{m2}/results"}).json()
    p = order["params"]
    assert order["mode"] == "test" and p["MID"] == billing_service.PUBLIC_TEST_MID and p["Amt"] == str(order["amount"])
    assert p["SignData"] == sha(p["EdiDate"] + p["MID"] + p["Amt"] + billing_service.PUBLIC_TEST_KEY)
    assert p["ReturnURL"].endswith("/api/billing/nicepay/return")

    # 위변조·금액 불일치는 승인 요청도 하지 않는다
    assert "/billing/fail" in _return(client, _auth_form(order, tamper=True)) and not pay
    order2 = client.post("/api/billing/orders", json={"product": "match", "match_id": m2}).json()
    assert "/billing/fail" in _return(client, _auth_form(order2, amount=100)) and not pay

    order3 = client.post("/api/billing/orders", json={"product": "match", "match_id": m2, "back": f"/matches/{m2}/results"}).json()
    loc = _return(client, _auth_form(order3))
    assert loc.startswith("https://site.example.test/billing/success")
    assert parse_qs(urlparse(loc).query)["back"] == [f"/matches/{m2}/results"]
    assert len(pay) == 1 and pay[0][0].startswith("https://dc1-api.nicepay.co.kr/")
    assert client.get(f"/api/billing/matches/{m2}/access").json()["reason"] == "match"
    # 같은 인증을 다시 보내도(새로고침) 승인은 한 번만
    _return(client, _auth_form(order3))
    assert len(pay) == 1


def test_team_month_pass_covers_all_team_matches(client, pay):
    tid = client.post("/api/teams", json={"name": "구독FC"}).json()["id"]
    order = client.post("/api/billing/orders", json={"product": "team_month", "team_id": tid}).json()
    assert "/billing/success" in _return(client, _auth_form(order))
    mid = _match(client, away_team_id=tid)
    assert client.get(f"/api/billing/matches/{mid}/access").json()["reason"] == "team"
    assert client.post("/api/billing/orders", json={"product": "team_month"}).status_code == 400
