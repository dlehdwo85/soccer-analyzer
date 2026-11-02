"""AI 경기 요약 — 맥락 만들기, 키 없음(503), 생성→저장→조회, MOM 후보 걸러내기, 기록 변경 표시.

Claude API는 부르지 않는다. ai_report_service.get_client를 가짜 클라이언트로 바꿔 끼운다.
"""

import json
import os
import tempfile
from types import SimpleNamespace

import pytest

_tmp = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/test.db"
os.environ["UPLOAD_DIR"] = os.path.join(_tmp, "uploads")
os.environ.pop("RUNPOD_API_KEY", None)
os.environ.pop("RUNPOD_ENDPOINT_ID", None)

from fastapi.testclient import TestClient  # noqa: E402

from app.services import ai_report_service  # noqa: E402
from app.services.ai_match_service import build_match_context  # noqa: E402
from main import app  # noqa: E402


class FakeClient:
    def __init__(self, payload):
        self.calls = []
        self.payload = payload
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self._create))

    def _create(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(stop_reason="end_turn", stop_details=None, model="claude-opus-5-5",
                               content=[SimpleNamespace(type="text", text=json.dumps(self.payload, ensure_ascii=False))],
                               usage=SimpleNamespace(input_tokens=900, output_tokens=300, iterations=None))


@pytest.fixture(scope="module")
def api():
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module")
def match_id(api):
    from app.database import SessionLocal
    from app.models import Match
    from app.services.result_service import save_result
    from app.vision.pipeline import AnalysisConfig, analyze_simulated

    mid = api.post("/api/matches", json={"title": "AI 요약 경기", "home_team_name": "월넛", "away_team_name": "바모스"}).json()["id"]
    res = analyze_simulated(AnalysisConfig(), duration_s=240, seed=7)
    db = SessionLocal()
    save_result(db, db.get(Match, mid), res, "sample")
    db.commit()
    db.close()
    return mid


def test_context_has_both_teams_and_top_players(api, match_id):
    view = api.get(f"/api/matches/{match_id}/result").json()
    ctx = build_match_context(view)
    assert ctx["teams"]["home"]["name"] == "월넛" and ctx["teams"]["away"]["name"] == "바모스"
    assert ctx["teams"]["home"]["possession_pct"] is not None
    teams = {p["team"] for p in ctx["players"]}
    assert teams == {"home", "away"}
    assert all(not p["track_id"].startswith("x") for p in ctx["players"])
    assert any("샘플" in f for f in ctx["data_quality"]["flags"])
    assert len(ctx["basis"]) == 64 and ctx["basis"] == build_match_context(view)["basis"]


def test_without_key_returns_503(api, match_id, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    r = api.post(f"/api/matches/{match_id}/ai-summary")
    assert r.status_code == 503
    assert api.get(f"/api/matches/{match_id}/ai-summary").status_code == 404


def test_generate_store_and_filter_mom(api, match_id, monkeypatch):
    view = api.get(f"/api/matches/{match_id}/result").json()
    ctx = build_match_context(view)
    good = [p["track_id"] for p in ctx["players"]][:2]
    payload = {
        "headline": "기록상 점유는 비슷했지만 슈팅은 한쪽이 많았습니다.",
        "key_points": ["패스 성공률 차이가 컸습니다.", " "],
        # 없는 선수·중복은 빠져야 한다
        "mom": [{"track_id": good[0], "reason": "키패스 2개"}, {"track_id": "NOPE", "reason": "없는 선수"},
                {"track_id": good[0], "reason": "중복"}, {"track_id": good[1], "reason": "가로채기 3개"}],
        "data_caveats": [],
    }
    client = FakeClient(payload)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(ai_report_service, "get_client", lambda: client)

    r = api.post(f"/api/matches/{match_id}/ai-summary")
    assert r.status_code == 200, r.text
    body = r.json()
    assert [m["track_id"] for m in body["summary"]["mom"]] == good
    assert body["summary"]["key_points"] == ["패스 성공률 차이가 컸습니다."]
    assert body["stale"] is False and body["usage"]["input_tokens"] == 900
    sent = json.loads(client.calls[0]["messages"][0]["content"].split("\n\n", 1)[1])
    assert "basis" not in sent and sent["teams"]["home"]["name"] == "월넛"

    got = api.get(f"/api/matches/{match_id}/ai-summary").json()
    assert got["summary"]["headline"] == payload["headline"] and got["stale"] is False

    # 이벤트를 지우면 기록이 바뀐 것으로 표시된다
    ev = next(e for e in view["events"] if e["kind"] == "pass")
    assert api.patch(f"/api/matches/{match_id}/events/{ev['id']}", json={"deleted": True}).status_code == 200
    assert api.get(f"/api/matches/{match_id}/ai-summary").json()["stale"] is True
