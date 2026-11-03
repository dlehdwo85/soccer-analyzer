"""카카오 로그인(카카오 API는 가짜로 바꿔 끼움)과 팀 권한·초대."""

import os
import tempfile
from urllib.parse import parse_qs, urlparse

import pytest

_tmp = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/test.db"
os.environ["UPLOAD_DIR"] = os.path.join(_tmp, "uploads")

from fastapi.testclient import TestClient  # noqa: E402

from app.services import auth_service  # noqa: E402
from main import app  # noqa: E402


@pytest.fixture()
def kakao(monkeypatch):
    monkeypatch.setenv("KAKAO_REST_API_KEY", "test-rest-key")
    monkeypatch.setenv("AUTH_SECRET", "test-secret")
    monkeypatch.setenv("KAKAO_REDIRECT_URI", "https://api.example.test/api/auth/kakao/callback")
    monkeypatch.setenv("SITE_URL", "https://site.example.test")
    people = iter([{"kakao_id": "111", "nickname": "팀장", "profile_image": None},
                   {"kakao_id": "222", "nickname": "팀원", "profile_image": None},
                   {"kakao_id": "333", "nickname": "남", "profile_image": None}])
    monkeypatch.setattr(auth_service, "exchange_code", lambda code, base="": next(people))


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


def _login(client) -> dict:
    start = client.get("/api/auth/kakao/start", params={"next": "/teams"}, follow_redirects=False)
    assert start.status_code == 302 and start.headers["location"].startswith(auth_service.KAKAO_AUTH)
    state = parse_qs(urlparse(start.headers["location"]).query)["state"][0]
    cb = client.get("/api/auth/kakao/callback", params={"code": "c", "state": state}, follow_redirects=False)
    loc = cb.headers["location"]
    assert loc.startswith("https://site.example.test/auth/done#token=") and loc.endswith("&next=/teams")
    token = loc.split("#token=")[1].split("&")[0]
    return {"Authorization": f"Bearer {token}"}


def test_token_roundtrip_and_tamper(monkeypatch):
    monkeypatch.setenv("AUTH_SECRET", "s")
    t = auth_service.make_token({"uid": 5})
    assert auth_service.read_token(t)["uid"] == 5
    assert auth_service.read_token(t[:-2] + "xx") is None
    assert auth_service.read_token(auth_service.make_token({"uid": 5}, ttl_s=-1)) is None
    assert auth_service.safe_next("//evil.example") == "/" and auth_service.safe_next("/teams/3") == "/teams/3"


def test_login_disabled_without_keys(client, monkeypatch):
    monkeypatch.delenv("KAKAO_REST_API_KEY", raising=False)
    cfg = client.get("/api/auth/config").json()
    assert cfg["kakao"] is False and cfg["redirect_uri"].endswith("/api/auth/kakao/callback")
    assert client.get("/api/auth/kakao/start", follow_redirects=False).status_code == 503
    assert client.get("/api/auth/me").status_code == 401


def test_team_roles_invite_and_permissions(client, kakao):
    owner, member, outsider = _login(client), _login(client), _login(client)
    assert client.get("/api/auth/me", headers=owner).json()["nickname"] == "팀장"

    team = client.post("/api/teams", json={"name": "권한FC"}, headers=owner).json()
    assert team["my_role"] == "owner" and team["member_count"] == 1
    tid = team["id"]
    # 팀원이 있는 팀은 로그인·권한 없이는 못 고친다
    assert client.put(f"/api/teams/{tid}", json={"name": "바꿈"}).status_code == 401
    assert client.put(f"/api/teams/{tid}", json={"name": "바꿈"}, headers=outsider).status_code == 403

    code = client.post(f"/api/teams/{tid}/invite", headers=owner).json()["invite_code"]
    assert client.post(f"/api/teams/{tid}/invite", headers=outsider).status_code == 403
    joined = client.post("/api/teams/join", json={"code": code}, headers=member).json()
    assert joined["my_role"] == "member" and not joined["can_edit"]
    assert client.put(f"/api/teams/{tid}", json={"name": "바꿈"}, headers=member).status_code == 403
    assert client.post("/api/teams/join", json={"code": "wrong"}, headers=member).status_code == 404

    mem = client.get(f"/api/teams/{tid}/members", headers=member).json()
    assert [m["role"] for m in mem["members"]] == ["owner", "member"] and mem["invite_code"] is None
    member_id = mem["members"][1]["id"]
    owner_id = mem["members"][0]["id"]
    # 팀장이 운영진으로 올리면 명단을 고칠 수 있다
    assert client.patch(f"/api/teams/{tid}/members/{member_id}", json={"role": "manager"}, headers=member).status_code == 403
    assert client.patch(f"/api/teams/{tid}/members/{member_id}", json={"role": "manager"}, headers=owner).status_code == 200
    r = client.put(f"/api/teams/{tid}", json={"name": "권한FC", "roster": [{"number": 9, "name": "골잡이"}]}, headers=member)
    assert r.status_code == 200 and r.json()["can_edit"]
    # 마지막 팀장은 내려갈 수 없다 / 팀 삭제는 팀장만
    assert client.patch(f"/api/teams/{tid}/members/{owner_id}", json={"role": "member"}, headers=owner).status_code == 400
    assert client.delete(f"/api/teams/{tid}", headers=member).status_code == 403
    # 본인은 나갈 수 있다
    assert client.delete(f"/api/teams/{tid}/members/{member_id}", headers=member).status_code == 204
    assert client.delete(f"/api/teams/{tid}", headers=owner).status_code == 204


def test_open_team_first_joiner_becomes_owner(client, kakao):
    a = _login(client)
    t = client.post("/api/teams", json={"name": "예전팀"}).json()    # 로그인 없이 만든 팀 — 누구나 고칠 수 있다
    assert t["can_edit"] and t["member_count"] == 0
    code = client.post(f"/api/teams/{t['id']}/invite", headers=a).json()["invite_code"]
    assert client.post("/api/teams/join", json={"code": code}, headers=a).json()["my_role"] == "owner"
    assert client.put(f"/api/teams/{t['id']}", json={"name": "예전팀2"}).status_code == 401
