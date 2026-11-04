"""API 통합 테스트 — 샘플 분석 → 결과 조회 → 트랙 편집 → 내보내기."""

import os
import tempfile

import pytest

_tmp = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/test.db"
os.environ["UPLOAD_DIR"] = os.path.join(_tmp, "uploads")
os.environ.pop("RUNPOD_API_KEY", None)
os.environ.pop("RUNPOD_ENDPOINT_ID", None)

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402

from app.services import analysis_service  # noqa: E402
from main import app  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module")
def analyzed(client):
    r = client.post("/api/matches", json={"title": "테스트 경기", "home_team_color": "#2563EB",
                                          "away_team_color": "#dc2626", "home_gk_color": "#f59e0b"})
    assert r.status_code == 201, r.text
    mid = r.json()["id"]
    r = client.post(f"/api/matches/{mid}/analyze", json={"mode": "sample", "max_seconds": 300})
    assert r.status_code == 200, r.text
    st = client.get(f"/api/matches/{mid}/status").json()
    assert st["status"] == "done" and st["has_result"], st
    return mid


def _team_sum(players, team, key):
    return sum(p["stats"][key] for p in players if p["team"] == team and not p["excluded"])


def test_match_crud_and_validation(client):
    r = client.post("/api/matches", json={"title": "x", "home_team_color": "red"})
    assert r.status_code == 422
    r = client.post("/api/matches", json={"title": "crud", "field_type": "futsal"})
    mid = r.json()["id"]
    r = client.patch(f"/api/matches/{mid}", json={"home_attacks": "left", "halftime_s": 1200, "away_gk_color": "#111111"})
    assert r.status_code == 200 and r.json()["home_attacks"] == "left" and r.json()["away_gk_color"] == "#111111"
    assert any(m["id"] == mid for m in client.get("/api/matches").json())
    assert client.get(f"/api/matches/{mid}/result").status_code == 409
    assert client.delete(f"/api/matches/{mid}").status_code == 204
    assert client.get(f"/api/matches/{mid}").status_code == 404


def test_sample_result_shape_and_consistency(client, analyzed):
    res = client.get(f"/api/matches/{analyzed}/result").json()
    assert res["version"] == 2 and res["meta"]["sample"] is True
    players = res["players"]
    assert {p["team"] for p in players} == {"home", "away"}
    assert any(p["label"] == "home_gk" for p in players)
    kinds = {e["kind"] for e in res["events"]}
    assert "pass" in kinds
    for team in ("home", "away"):
        ts = res["team_stats"][team]
        assert ts["passes_attempted"] == _team_sum(players, team, "passes_attempted")
        assert ts["shots"] == _team_sum(players, team, "shots")
    ph, pa = res["team_stats"]["home"]["possession_pct"], res["team_stats"]["away"]["possession_pct"]
    assert abs(ph + pa - 100) < 0.2
    p = players[0]["stats"]
    for k in ("touches", "passes_completed", "passes_failed", "key_passes", "shots_on_target", "xg",
              "interceptions", "recoveries", "pass_accuracy", "minutes_tracked"):
        assert k in p
    for k in ("distance_m", "sprint_m", "top_speed_kmh", "heat"):
        assert k not in p
    assert res["pass_network"]["home"]["nodes"]
    assert res["possession_timeline"]
    assert res["possessions"]


def test_merge_unmerge_exclude_and_team_change(client, analyzed):
    url = f"/api/matches/{analyzed}"
    before = client.get(f"{url}/result").json()
    home = [p for p in before["players"] if p["team"] == "home" and p["label"] == "home"]
    a, b = home[0], home[1]
    time_sum = a["stats"]["seconds_tracked"] + b["stats"]["seconds_tracked"]

    r = client.post(f"{url}/players/merge", json={"target": a["track_id"], "sources": [b["track_id"]]})
    assert r.status_code == 200
    after = client.get(f"{url}/result").json()
    assert len(after["players"]) == len(before["players"]) - 1
    merged = next(p for p in after["players"] if p["track_id"] == a["track_id"])
    assert merged["merged_from"] == [b["track_id"]]
    assert merged["stats"]["seconds_tracked"] == pytest.approx(time_sum, abs=0.01)
    assert all(e["player"] != b["track_id"] for e in after["events"])
    assert client.patch(f"{url}/players/{b['track_id']}", json={"display_name": "x"}).status_code == 400

    assert client.post(f"{url}/players/{b['track_id']}/unmerge").status_code == 200
    restored = client.get(f"{url}/result").json()
    assert len(restored["players"]) == len(before["players"])
    assert restored["team_stats"] == before["team_stats"]

    # 팀 변경: 패스 성공 여부가 새 팀 기준으로 다시 판정되고 팀 합계가 맞아야 한다
    c = max(home, key=lambda p: p["stats"]["passes_attempted"])
    assert client.patch(f"{url}/players/{c['track_id']}", json={"team": "away"}).status_code == 200
    flipped = client.get(f"{url}/result").json()
    fc = next(p for p in flipped["players"] if p["track_id"] == c["track_id"])
    assert fc["team"] == "away" and fc["label"] == "away"
    for team in ("home", "away"):
        assert flipped["team_stats"][team]["passes_attempted"] == _team_sum(flipped["players"], team, "passes_attempted")
        assert flipped["team_stats"][team]["passes_completed"] == _team_sum(flipped["players"], team, "passes_completed")
    for e in flipped["events"]:
        if e["kind"] == "pass" and e["player"] == c["track_id"] and e["target"]:
            tgt = next(p for p in flipped["players"] if p["track_id"] == e["target"])
            assert e["success"] == (tgt["team"] == "away")
    client.patch(f"{url}/players/{c['track_id']}", json={"team": "home"})
    assert client.get(f"{url}/result").json()["team_stats"] == before["team_stats"]

    # 제외: 결과 팀 합계에서 빠진다
    client.patch(f"{url}/players/{a['track_id']}", json={"excluded": True})
    ex = client.get(f"{url}/result").json()
    assert next(p for p in ex["players"] if p["track_id"] == a["track_id"])["excluded"]
    assert all(e["player"] != a["track_id"] for e in ex["events"])
    client.patch(f"{url}/players/{a['track_id']}", json={"excluded": False})


def test_names_csv_and_profiles(client, analyzed):
    url = f"/api/matches/{analyzed}"
    res = client.get(f"{url}/result").json()
    p = next(p for p in res["players"] if p["team"] == "home" and not p["minor"])
    r = client.patch(f"{url}/players/{p['track_id']}", json={"display_name": "손흥민", "jersey_number": 7})
    assert r.status_code == 200
    csv = client.get(f"{url}/export.csv")
    assert csv.status_code == 200 and csv.text.startswith("﻿팀,트랙,이름")
    assert "손흥민" in csv.text
    profs = client.get("/api/players").json()
    me = next(x for x in profs if x["name"] == "손흥민")
    assert me["match_count"] == 1 and me["jersey_number"] == 7
    detail = client.get("/api/players/손흥민").json()
    assert detail["matches"][0]["match_id"] == analyzed
    assert client.get("/api/players/없는선수").status_code == 404


def test_calibration(client, analyzed):
    url = f"/api/matches/{analyzed}/calibration"
    pts = [[0.1, 0.3], [0.9, 0.3], [1.0, 0.9], [0.0, 0.9]]
    r = client.put(url, json={"preset": "left_half", "image_points": pts, "length": 90, "width": 55})
    assert r.status_code == 200 and r.json()["calibrated"]
    cal = client.get(url).json()
    assert cal["pitch_points"][1] == [45, 0] and cal["length"] == 90
    bad = client.put(url, json={"preset": "full", "image_points": [[0, 0], [0.5, 0.5], [1, 1], [0.25, 0.25]]})
    assert bad.status_code == 422
    assert client.delete(url).json()["calibrated"] is False


def test_video_analysis_requires_engine_and_upload(client, monkeypatch):
    mid = client.post("/api/matches", json={"title": "video"}).json()["id"]
    assert client.post(f"/api/matches/{mid}/analyze", json={"mode": "video"}).status_code == 400
    data = os.urandom(3000)
    r = client.post(f"/api/matches/{mid}/upload", files={"file": ("../../evil name.MP4", data, "video/mp4")})
    assert r.status_code == 200, r.text
    assert r.json()["video_url"] == f"local:{mid}/video.mp4"
    assert client.post(f"/api/matches/{mid}/upload", files={"file": ("a.exe", b"x", "application/x")}).status_code == 400

    full = client.get(f"/api/matches/{mid}/video")
    assert full.status_code == 200 and full.content == data
    part = client.get(f"/api/matches/{mid}/video", headers={"Range": "bytes=100-199"})
    assert part.status_code == 206 and part.content == data[100:200]
    assert part.headers["content-range"] == "bytes 100-199/3000"

    monkeypatch.setattr(analysis_service, "engines", lambda: {"runpod": False, "local": False})
    r = client.post(f"/api/matches/{mid}/analyze", json={"mode": "video"})
    assert r.status_code == 503
    assert client.get(f"/api/matches/{mid}").json()["status"] == "uploaded"


def test_video_analysis_failure_is_reported_not_faked(client, monkeypatch):
    mid = client.post("/api/matches", json={"title": "fail"}).json()["id"]
    client.post(f"/api/matches/{mid}/upload", files={"file": ("a.mp4", b"not a video", "video/mp4")})
    monkeypatch.setattr(analysis_service, "engines", lambda: {"runpod": False, "local": True})
    monkeypatch.setattr(analysis_service, "local_engine_available", lambda: True)

    def boom(*a, **k):
        raise RuntimeError("영상을 열 수 없습니다")
    import app.vision.pipeline as pipeline
    monkeypatch.setattr(pipeline, "analyze_video", boom)
    assert client.post(f"/api/matches/{mid}/analyze", json={"mode": "video"}).status_code == 200
    st = client.get(f"/api/matches/{mid}/status").json()
    assert st["status"] == "failed" and "열 수 없습니다" in st["error"] and not st["has_result"]


def test_event_review_edit_delete_add(client, analyzed):
    url = f"/api/matches/{analyzed}"
    res = client.get(f"{url}/result").json()
    ts0 = res["team_stats"]
    home = [p for p in res["players"] if p["team"] == "home" and not p["minor"]]
    away = [p for p in res["players"] if p["team"] == "away" and not p["minor"]]
    ok_pass = next(e for e in res["events"] if e["kind"] == "pass" and e["success"] and e["team"] == "home")

    # 성공 패스를 '아웃'으로 고치면 실패가 하나 늘고 성공이 하나 준다
    r = client.patch(f"{url}/events/{ok_pass['id']}", json={"result": "out"})
    assert r.status_code == 200, r.text
    res1 = client.get(f"{url}/result").json()
    assert res1["team_stats"]["home"]["passes_completed"] == ts0["home"]["passes_completed"] - 1
    assert res1["team_stats"]["home"]["passes_failed"] == ts0["home"]["passes_failed"] + 1
    e1 = next(e for e in res1["events"] if e["id"] == ok_pass["id"])
    assert e1["edited"] and e1["detail"]["reason"] == "out" and e1["target"] is None

    # 상대 선수에게 간 것으로 고치면 차단(가로채기)
    r = client.patch(f"{url}/events/{ok_pass['id']}", json={"target": away[0]["track_id"], "result": "intercepted"})
    res2 = client.get(f"{url}/result").json()
    e2 = next(e for e in res2["events"] if e["id"] == ok_pass["id"])
    assert e2["success"] is False and e2["detail"]["reason"] == "intercepted"
    assert next(p for p in res2["players"] if p["track_id"] == away[0]["track_id"])["stats"]["interceptions"] >= 1

    # 지우기 → 시도 수에서 빠진다
    client.patch(f"{url}/events/{ok_pass['id']}", json={"deleted": True})
    res3 = client.get(f"{url}/result").json()
    assert res3["team_stats"]["home"]["passes_attempted"] == ts0["home"]["passes_attempted"] - 1
    assert all(e["id"] != ok_pass["id"] for e in res3["events"])

    # 놓친 유효 슈팅 추가 (누가 슈팅했는지만 알면 된다)
    shooter = home[1]["track_id"]
    before = next(p for p in res3["players"] if p["track_id"] == shooter)["stats"]
    r = client.post(f"{url}/events", json={"kind": "shot", "t": 100.0, "player": shooter, "result": "on_target"})
    assert r.status_code == 201, r.text
    res4 = client.get(f"{url}/result").json()
    after = next(p for p in res4["players"] if p["track_id"] == shooter)["stats"]
    assert after["shots"] == before["shots"] + 1 and after["shots_on_target"] == before["shots_on_target"] + 1
    assert any(e["manual"] for e in res4["events"])

    assert client.patch(f"{url}/events/{ok_pass['id']}", json={"player": "없는트랙"}).status_code == 422
    assert client.post(f"{url}/events", json={"kind": "shot", "t": 1, "player": shooter, "result": "goal"}).status_code == 422

    # 초기화: 추가한 것은 지우고 지운 것은 되살린다
    client.post(f"{url}/events/reset")
    res5 = client.get(f"{url}/result").json()
    assert not any(e["manual"] for e in res5["events"])
    assert any(e["id"] == ok_pass["id"] for e in res5["events"])


def test_period_filter(client, analyzed):
    url = f"/api/matches/{analyzed}"
    full = client.get(f"{url}/result").json()
    assert full["period"] is None
    # 후반 시작 시각이 없으면 전체로 응답
    assert client.get(f"{url}/result?period=1").json()["period"] is None
    client.patch(url, json={"halftime_s": 150})
    h1 = client.get(f"{url}/result?period=1").json()
    h2 = client.get(f"{url}/result?period=2").json()
    assert h1["period"] == 1 and h2["period"] == 2
    assert all(e["t"] < 150 for e in h1["events"]) and all(e["t"] >= 150 for e in h2["events"])
    for team in ("home", "away"):
        assert (h1["team_stats"][team]["passes_attempted"] + h2["team_stats"][team]["passes_attempted"]
                == full["team_stats"][team]["passes_attempted"])
    assert h2["possession_timeline"][0]["start_s"] >= 150
    assert client.get(f"{url}/export.csv?period=2").status_code == 200
    assert client.get(f"{url}/result?period=3").status_code == 422


def test_video_library(client, monkeypatch):
    from app.services import storage_service
    mid = client.post("/api/matches", json={"title": "예전 영상 경기"}).json()["id"]
    client.post(f"/api/matches/{mid}/set-video-url", json={"video_url": "https://pub-x.r2.dev/matches/9/a.mp4", "filename": "a.mp4"})
    monkeypatch.setattr(storage_service, "is_configured", lambda: True)
    monkeypatch.setattr(storage_service, "list_videos", lambda: [
        {"key": "matches/9/a.mp4", "url": "https://pub-x.r2.dev/matches/9/a.mp4", "filename": "a.mp4", "size_mb": 1, "last_modified": None},
        {"key": "matches/3/old.mov", "url": "https://pub-x.r2.dev/matches/3/old.mov", "filename": "old.mov", "size_mb": 900, "last_modified": None},
    ])
    lib = client.get("/api/videos").json()
    me = next(v for v in lib["matches"] if v["match_id"] == mid)
    assert me["needs_analysis"] is True
    assert [o["filename"] for o in lib["orphans"]] == ["old.mov"]
    assert lib["storage"] is True


def test_health_and_old_db_upgrade(client):
    h = client.get("/api/health").json()
    assert h["status"] == "ok" and set(h["engines"]) == {"runpod", "local"}

    from app.database import add_missing_columns
    eng = create_engine(f"sqlite:///{_tmp}/old.db")
    with eng.begin() as conn:
        conn.execute(text("CREATE TABLE matches (id INTEGER PRIMARY KEY, title VARCHAR(255), status VARCHAR(20))"))
        conn.execute(text("INSERT INTO matches (id, title, status) VALUES (1, 'old', 'done')"))
    added = add_missing_columns(eng)
    assert "matches.calibration_json" in added and "matches.analysis_version" in added
    with eng.connect() as conn:
        assert conn.execute(text("SELECT analysis_version, home_attacks FROM matches")).one() == (0, "auto")
    assert add_missing_columns(eng) == []


def test_overlay_endpoint_roundtrip(client):
    from app.database import SessionLocal
    from app.models import Match
    from app.services.result_service import save_result
    from app.vision.pipeline import AnalysisConfig, analyze_simulated

    r = client.post("/api/matches", json={"title": "오버레이 확인"})
    mid = r.json()["id"]
    res = analyze_simulated(AnalysisConfig(), duration_s=60, seed=3)
    res["overlay"] = {"v": 1, "w": 1920, "h": 1080, "start_s": 0.0, "step": 0.2, "n": 3,
                      "tracks": {"P1": [[0, 10, 20, 30, 80]]}, "ball": [[0, 100, 200, 1]]}
    db = SessionLocal()
    save_result(db, db.get(Match, mid), res, "video")
    db.commit(); db.close()
    o = client.get(f"/api/matches/{mid}/overlay")
    assert o.status_code == 200
    body = o.json() if o.headers.get("content-encoding") != "gzip" or isinstance(o.content, bytes) and o.content[:1] == b"{" \
        else json.loads(gzip.decompress(o.content))
    assert body["tracks"]["P1"][0] == [0, 10, 20, 30, 80] and body["ball"][0] == [0, 100, 200, 1]
    assert client.get(f"/api/matches/{mid}").json().get("web_video_url") is None


def test_team_roster_auto_merge_and_season(client):
    r = client.post("/api/teams", json={"name": "월넛FC", "color": "#56b4d3",
                                        "roster": [{"number": 10, "name": "김철수"}, {"number": 7, "name": "이영희"},
                                                   {"number": 3, "name": "김철수"}]})
    assert r.status_code == 201, r.text
    team = r.json()
    assert [x["name"] for x in team["roster"]] == ["김철수", "이영희"]   # 같은 이름은 한 번만
    m = client.post("/api/matches", json={"title": "시즌 경기", "date": "2026-11-01", "home_team_name": "월넛FC",
                                          "home_team_id": team["id"]}).json()
    assert m["home_team_id"] == team["id"]
    client.post(f"/api/matches/{m['id']}/analyze", json={"mode": "sample", "max_seconds": 300})
    url = f"/api/matches/{m['id']}"
    home = [p for p in client.get(f"{url}/result").json()["players"] if p["team"] == "home" and not p["minor"]]
    a, b = home[0], home[1]
    assert client.patch(f"{url}/players/{a['track_id']}", json={"display_name": "김철수"}).json()["merged_into"] is None
    # 같은 이름을 고르면 같은 사람 → 자동으로 합쳐진다
    merged = client.patch(f"{url}/players/{b['track_id']}", json={"display_name": "김철수"}).json()["merged_into"]
    assert merged in (a["track_id"], b["track_id"])
    after = client.get(f"{url}/result").json()["players"]
    head = next(p for p in after if p["track_id"] == merged)
    assert len(head["merged_from"]) == 1 and head["display_name"] == "김철수"

    s = client.get(f"/api/teams/{team['id']}/season", params={"year": 2026}).json()
    assert s["record"]["played"] == 1 and s["record"]["scored_known"] == 0   # 샘플엔 점수 자막이 없다
    kim = next(p for p in s["players"] if p["name"] == "김철수")
    assert kim["matches"] == 1 and kim["number"] == 10 and kim["in_roster"]
    lee = next(p for p in s["players"] if p["name"] == "이영희")
    assert lee["matches"] == 0
    assert client.get(f"/api/teams/{team['id']}/season", params={"year": 2025}).json()["record"]["played"] == 0
    assert client.delete(f"/api/teams/{team['id']}").status_code == 204
    assert client.get(url).json()["home_team_id"] is None


def test_save_result_restores_stringified_booleans():
    from app.services.result_service import _clean_detail
    assert _clean_detail({"forward": "False", "on_target": "True", "reason": "completed", "n": 3}) == \
        {"forward": False, "on_target": True, "reason": "completed", "n": 3}


def test_player_role_gk_and_referee(client, analyzed):
    url = f"/api/matches/{analyzed}"
    p = next(p for p in client.get(f"{url}/result").json()["players"] if p["team"] == "away" and not p["excluded"])
    tid = p["track_id"]
    client.patch(f"{url}/players/{tid}", json={"role": "gk"})
    row = next(x for x in client.get(f"{url}/result").json()["players"] if x["track_id"] == tid)
    assert row["label"] == "away_gk" and not row["excluded"]
    client.patch(f"{url}/players/{tid}", json={"role": "referee"})
    row = next(x for x in client.get(f"{url}/result").json()["players"] if x["track_id"] == tid)
    assert row["label"] == "referee" and row["excluded"]
    client.patch(f"{url}/players/{tid}", json={"role": "player"})
    row = next(x for x in client.get(f"{url}/result").json()["players"] if x["track_id"] == tid)
    assert row["label"] == "away" and not row["excluded"]
