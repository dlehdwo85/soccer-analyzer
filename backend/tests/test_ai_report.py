"""AI 선수 분석 — 맥락 만들기, 키 없음(503), 생성→저장→조회, 거절·API 오류 처리.

Claude API는 부르지 않는다. ai_report_service.get_client를 가짜 클라이언트로 바꿔 끼운다.
"""

import json
import os
import re
import tempfile
from types import SimpleNamespace

import pytest

_tmp = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/test.db"
os.environ["UPLOAD_DIR"] = os.path.join(_tmp, "uploads")
os.environ.pop("RUNPOD_API_KEY", None)
os.environ.pop("RUNPOD_ENDPOINT_ID", None)

import anthropic  # noqa: E402
import httpx2  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402

from app.services import ai_report_service  # noqa: E402
from app.services.ai_report_service import build_player_context, context_basis  # noqa: E402
from main import app  # noqa: E402

REPORT = {
    "summary": "기록상 패스 연결이 안정적이었습니다. 슈팅 기회는 적었습니다.",
    "rating": 7,
    "strengths": ["패스 성공률이 팀 평균보다 높았습니다 (03:12 전진 패스 성공)."],
    "improvements": ["상대 진영에서 볼을 잃는 장면이 있었습니다."],
    "next_match_tips": ["받기 전에 주변을 한 번 더 확인해 보세요."],
    "data_caveats": ["샘플 데이터입니다."],
}


class FakeClient:
    def __init__(self, response=None, error=None):
        self.calls = []
        self.response, self.error = response, error
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self._create))

    def _create(self, **kwargs):
        self.calls.append(kwargs)
        if self.error is not None:
            raise self.error
        return self.response


def fake_response(payload=None, stop_reason="end_turn", content=None, model="claude-opus-5-5"):
    if content is None:
        content = [SimpleNamespace(type="thinking", thinking=""),
                   SimpleNamespace(type="text", text=json.dumps(payload, ensure_ascii=False))]
    return SimpleNamespace(stop_reason=stop_reason, stop_details=None, content=content, model=model,
                           usage=SimpleNamespace(input_tokens=1234, output_tokens=567, iterations=None))


def use_client(monkeypatch, client):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(ai_report_service, "get_client", lambda: client)
    return client


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

    mid = api.post("/api/matches", json={"title": "AI 분석 경기"}).json()["id"]
    res = analyze_simulated(AnalysisConfig(), duration_s=240, seed=11)
    db = SessionLocal()
    save_result(db, db.get(Match, mid), res, "sample")
    db.commit()
    db.close()
    return mid


def _view(api, mid):
    return api.get(f"/api/matches/{mid}/result").json()


def _busy_players(view, n=3):
    """볼 기록이 많은 필드 선수 n명 (같은 팀 아니어도 됨)."""
    ps = [p for p in view["players"] if not p["minor"] and not p["excluded"] and not p["label"].endswith("_gk")]
    ps.sort(key=lambda p: -(p["stats"]["passes_attempted"] + p["stats"]["touches"]))
    return ps[:n]


# ── 맥락 ────────────────────────────────────────────────────────────────────

def test_build_player_context_from_view(api, match_id):
    view = _view(api, match_id)
    p = _busy_players(view, 1)[0]
    ctx = build_player_context(view, p["track_id"])

    assert ctx["player"]["track_id"] == p["track_id"] and ctx["player"]["is_goalkeeper"] is False
    assert ctx["stats"]["passes_attempted"] == p["stats"]["passes_attempted"]
    assert ctx["stats"]["minutes_tracked"] == p["stats"]["minutes_tracked"]
    assert ctx["team_average"]["players_counted"] > 1
    assert set(ctx["team_average"]["per_player"]) >= {"touches", "passes_attempted", "shots", "recoveries"}
    assert ctx["per_10min"] is not None

    # 본인 이벤트만, 시각은 m:ss
    mine = [e for e in view["events"] if e["player"] == p["track_id"] or e["target"] == p["track_id"]]
    assert ctx["events"] and len(ctx["events"]) <= len(mine)
    own_passes = sum(1 for e in ctx["events"] if e["kind"] == "pass" and e["role"] == "본인")
    assert own_passes == p["stats"]["passes_attempted"]
    assert all(re.fullmatch(r"\d+:\d{2}(:\d{2})?", e["time"]) for e in ctx["events"])
    assert all(e["role"] in ("본인", "받음", "가로챔", "뺏김", "슈팅 막음") for e in ctx["events"])

    pos = ctx["average_position"]
    assert pos["avg_x"] == p["stats"]["avg_x"] and 0 <= pos["distance_from_center_line"] <= 1

    dq = ctx["data_quality"]
    assert dq["source"] == "sample" and any("샘플" in f for f in dq["flags"])
    assert dq["track_pieces"] == 1 and dq["expected_players_per_team"] == 11

    assert len(ctx["basis"]) == 64
    assert context_basis(build_player_context(view, p["track_id"])) == ctx["basis"]
    with pytest.raises(KeyError):
        build_player_context(view, "없는트랙")


def test_context_flags_low_quality():
    stats = {k: 0 for k in ai_report_service.COUNT_KEYS}
    stats.update(touches=2, minutes_tracked=3.2, pass_accuracy=None, avg_pass_length_m=None, avg_x=0.7, avg_y=0.2,
                 first_seen_s=10.0, last_seen_s=200.0)
    players = [{"track_id": "T1", "team": "home", "label": "home", "excluded": False, "minor": False,
                "display_name": None, "jersey_number": 9, "merged_from": ["T5"], "stats": stats}]
    players += [{"track_id": f"H{i}", "team": "home", "label": "home", "excluded": False, "minor": False,
                 "display_name": None, "jersey_number": None, "merged_from": [], "stats": dict(stats, minutes_tracked=10)}
                for i in range(20)]
    view = {"players": players, "events": [], "team_stats": {},
            "meta": {"source": "video", "duration_s": 1200, "ball_detected_pct": 72.4, "camera_moving": True,
                     "calibrated": False, "warnings": ["카메라가 움직이는 영상입니다."], "halftime_rel_s": None,
                     "attack": {"first": {"home": -1, "away": 1}, "second": {"home": 1, "away": -1}},
                     "field": {"type": "soccer", "length": 105, "width": 68}}}
    ctx = build_player_context(view, "T1")
    flags = " ".join(ctx["data_quality"]["flags"])
    for word in ("공 검출률", "출전 시간", "트랙이 21개", "카메라", "보정"):
        assert word in flags, word
    assert ctx["player"]["name"] == "9번" and ctx["data_quality"]["track_pieces"] == 2
    assert ctx["average_position"]["depth_toward_opponent_goal"] == pytest.approx(0.3)  # 왼쪽(-x)으로 공격
    assert ctx["per_10min"]["touches"] == pytest.approx(6.25)
    assert ctx["data_quality"]["warnings"] == ["카메라가 움직이는 영상입니다."]


# ── API ─────────────────────────────────────────────────────────────────────

def test_without_api_key_returns_503(api, match_id, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)

    def never():
        raise AssertionError("키가 없으면 클라이언트를 만들지 않아야 합니다")
    monkeypatch.setattr(ai_report_service, "get_client", never)
    tid = _busy_players(_view(api, match_id), 1)[0]["track_id"]
    r = api.post(f"/api/matches/{match_id}/players/{tid}/ai-report")
    assert r.status_code == 503
    assert r.json()["detail"] == "AI 분석을 쓰려면 서버에 ANTHROPIC_API_KEY를 설정해야 합니다"
    with pytest.raises(ai_report_service.AIReportNotConfigured):
        ai_report_service.generate_player_report({"basis": "x"})


def test_generate_store_get_roundtrip(api, match_id, monkeypatch):
    view = _view(api, match_id)
    p, other = _busy_players(view, 2)
    tid = p["track_id"]
    url = f"/api/matches/{match_id}/players/{tid}/ai-report"
    assert api.get(url).status_code == 404

    fake = use_client(monkeypatch, FakeClient(fake_response(REPORT)))
    r = api.post(url)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["track_id"] == tid and body["report"] == REPORT and body["stale"] is False
    assert body["model"] == "claude-opus-5-5"
    assert body["usage"] == {"input_tokens": 1234, "output_tokens": 567}
    assert body["generated_at"].endswith(("Z", "+00:00"))

    # 요청 모양: 모델·폴백·구조화 출력·effort, thinking은 보내지 않는다
    call = fake.calls[0]
    assert call["model"] == "claude-opus-5-5" and call["max_tokens"] == 8000
    assert call["betas"] == ["server-side-fallback-2026-07-01"] and call["fallbacks"] == "default"
    assert call["output_config"]["effort"] == "medium"
    fmt = call["output_config"]["format"]
    assert fmt["type"] == "json_schema" and set(fmt["schema"]["required"]) == set(REPORT)
    assert "thinking" not in call
    sent = call["messages"][0]["content"]
    assert tid in sent and '"basis"' not in sent and "기록만 근거로" in sent

    # 저장된 분석 조회 + 결과 뷰 표시
    g = api.get(url).json()
    assert g["report"] == REPORT and g["stale"] is False
    row = next(x for x in _view(api, match_id)["players"] if x["track_id"] == tid)
    assert row["ai_report_at"] and row["ai_report_stale"] is False
    assert next(x for x in _view(api, match_id)["players"] if x["track_id"] == other["track_id"])["ai_report_at"] is None

    # 이 선수의 이벤트를 지우면 기록이 바뀐 것으로 표시
    ev = next(e for e in view["events"] if e["player"] == tid)
    assert api.patch(f"/api/matches/{match_id}/events/{ev['id']}", json={"deleted": True}).status_code == 200
    assert api.get(url).json()["stale"] is True
    assert next(x for x in _view(api, match_id)["players"] if x["track_id"] == tid)["ai_report_stale"] is True
    api.patch(f"/api/matches/{match_id}/events/{ev['id']}", json={"deleted": False})
    assert api.get(url).json()["stale"] is False

    # 다시 분석하면 덮어쓴다
    use_client(monkeypatch, FakeClient(fake_response(dict(REPORT, rating=None, summary="판단을 보류합니다."))))
    again = api.post(url).json()
    assert again["report"]["rating"] is None and again["report"]["summary"] == "판단을 보류합니다."

    # 병합된 트랙으로 조회해도 대표 선수의 분석
    piece = next(x for x in view["players"] if x["team"] == p["team"] and not x["excluded"] and x["track_id"] != tid)
    assert api.post(f"/api/matches/{match_id}/players/merge",
                    json={"target": tid, "sources": [piece["track_id"]]}).status_code == 200
    via_piece = api.get(f"/api/matches/{match_id}/players/{piece['track_id']}/ai-report").json()
    assert via_piece["track_id"] == tid
    api.post(f"/api/matches/{match_id}/players/{piece['track_id']}/unmerge")

    assert api.get(f"/api/matches/{match_id}/players/없는트랙/ai-report").status_code == 404


def test_refusal_is_not_stored(api, match_id, monkeypatch):
    p = _busy_players(_view(api, match_id), 3)[2]
    url = f"/api/matches/{match_id}/players/{p['track_id']}/ai-report"
    # 거절 응답은 content를 읽지 않는다 (일부 텍스트가 있어도 버린다)
    partial = [SimpleNamespace(type="text", text='{"summary": "부분')]
    use_client(monkeypatch, FakeClient(fake_response(stop_reason="refusal", content=partial)))
    r = api.post(url)
    assert r.status_code == 502 and "거절" in r.json()["detail"]
    assert api.get(url).status_code == 404

    use_client(monkeypatch, FakeClient(fake_response(stop_reason="max_tokens", content=partial)))
    assert api.post(url).status_code == 502
    use_client(monkeypatch, FakeClient(fake_response(content=[SimpleNamespace(type="text", text="형식 아님")])))
    assert "형식" in api.post(url).json()["detail"]
    assert api.get(url).status_code == 404


def test_api_errors_map_to_502(api, match_id, monkeypatch):
    tid = _busy_players(_view(api, match_id), 3)[2]["track_id"]
    url = f"/api/matches/{match_id}/players/{tid}/ai-report"
    req = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")
    cases = [
        (anthropic.AuthenticationError("bad key", response=httpx2.Response(401, request=req), body=None), "ANTHROPIC_API_KEY"),
        (anthropic.RateLimitError("slow down", response=httpx2.Response(429, request=req), body=None), "한도"),
        (anthropic.InternalServerError("boom", response=httpx2.Response(500, request=req), body=None), "잠시"),
        (anthropic.BadRequestError("bad", response=httpx2.Response(400, request=req), body=None), "400"),
        (anthropic.APIConnectionError(request=req), "연결"),
    ]
    for err, word in cases:
        use_client(monkeypatch, FakeClient(error=err))
        r = api.post(url)
        assert r.status_code == 502, (type(err), r.text)
        assert word in r.json()["detail"], (type(err), r.json())
    assert api.get(url).status_code == 404


def test_fallback_served_response_is_used(monkeypatch):
    blocks = [SimpleNamespace(type="text", text="버려진 부분"),
              SimpleNamespace(type="fallback", from_=SimpleNamespace(model="claude-opus-5-5"),
                              to=SimpleNamespace(model="claude-opus-4-8")),
              SimpleNamespace(type="text", text=json.dumps(dict(REPORT, rating=42), ensure_ascii=False))]
    resp = fake_response(content=blocks, model="claude-opus-4-8")
    resp.usage.iterations = [SimpleNamespace(type="message"), SimpleNamespace(type="fallback_message")]
    use_client(monkeypatch, FakeClient(resp))
    out = ai_report_service.generate_player_report({"basis": "x", "stats": {}})
    assert out["model"] == "claude-opus-4-8" and out["fallback_used"] is True
    assert out["report"]["rating"] is None  # 범위 밖 평점은 판단 보류로


def test_real_sdk_request_shape(monkeypatch):
    """실제 SDK가 만드는 HTTP 요청(헤더·본문)을 가짜 전송 계층으로 받아 확인한다. 네트워크는 쓰지 않는다."""
    seen = {}

    def handler(request):
        seen["headers"], seen["body"] = request.headers, json.loads(request.content)
        return httpx2.Response(200, json={
            "id": "msg_test", "type": "message", "role": "assistant", "model": "claude-opus-5-5",
            "content": [{"type": "thinking", "thinking": "", "signature": "sig"},
                        {"type": "text", "text": json.dumps(REPORT, ensure_ascii=False)}],
            "stop_reason": "end_turn", "stop_sequence": None, "stop_details": None,
            "usage": {"input_tokens": 10, "output_tokens": 20}})

    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(ai_report_service, "get_client", lambda: anthropic.Anthropic(
        http_client=anthropic.DefaultHttpxClient(transport=httpx2.MockTransport(handler)), max_retries=0))
    out = ai_report_service.generate_player_report({"basis": "x", "stats": {"touches": 1}})
    assert out["report"] == REPORT and out["usage"] == {"input_tokens": 10, "output_tokens": 20}
    assert seen["headers"]["anthropic-beta"] == "server-side-fallback-2026-07-01"
    body = seen["body"]
    assert body["model"] == "claude-opus-5-5" and body["fallbacks"] == "default" and body["max_tokens"] == 8000
    assert body["output_config"]["effort"] == "medium" and body["output_config"]["format"]["type"] == "json_schema"
    assert "thinking" not in body and isinstance(body["system"], str)


def test_old_db_gets_ai_report_columns():
    from app.database import add_missing_columns
    eng = create_engine(f"sqlite:///{_tmp}/old_players.db")
    with eng.begin() as conn:
        conn.execute(text("CREATE TABLE match_players (id INTEGER PRIMARY KEY, match_id INTEGER, track_id VARCHAR(50), "
                          "team VARCHAR(10), stats_json TEXT)"))
        conn.execute(text("INSERT INTO match_players (id, match_id, track_id, team, stats_json) "
                          "VALUES (1, 1, 'P1', 'home', '{}')"))
    added = add_missing_columns(eng)
    for col in ("ai_report_json", "ai_report_at", "ai_report_basis"):
        assert f"match_players.{col}" in added
    with eng.connect() as conn:
        assert conn.execute(text("SELECT ai_report_json, ai_report_at, ai_report_basis FROM match_players")).one() == \
            (None, None, None)
    assert add_missing_columns(eng) == []
