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
    for k in ("sprint_m", "heat"):
        assert k not in p
    # 샘플은 위치가 미터라 이동 거리·최고 속도를 잰다 (화면 좌표뿐인 영상에는 이 항목이 없다 — test_events_stats)
    assert p["distance_km"] is not None and p["top_speed_kmh"] is not None
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
    # 합쳐진 조각은 역할을 바꿀 수 없다 (이름은 경기 화면에서 조각에 넣을 수 있다 — test_name_on_fragment...)
    assert client.patch(f"{url}/players/{b['track_id']}", json={"role": "gk"}).status_code == 400

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
    _set_span(m["id"], a["track_id"], 0, 100)     # 같은 사람이려면 시간이 겹치지 않아야 한다 (겹치면 409)
    _set_span(m["id"], b["track_id"], 120, 200)
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


def _set_span(match_id, tid, t0, t1):
    """테스트용: 트랙이 보인 시간(첫·마지막)을 정한다."""
    import json
    from app.database import SessionLocal
    from app.models import MatchPlayer
    db = SessionLocal()
    r = db.query(MatchPlayer).filter(MatchPlayer.match_id == match_id, MatchPlayer.track_id == tid).one()
    st = json.loads(r.stats_json or "{}")
    st["first_seen_s"], st["last_seen_s"] = t0, t1
    r.stats_json = json.dumps(st)
    db.commit()
    db.close()


def test_name_on_fragment_detaches_and_overlap_blocks(client):
    """경기 화면에서 이름을 넣으면 그 장면의 조각에 붙는다. 같은 시간에 두 곳에 있는 같은 이름은 막고,
    자동 정리가 짐작으로 붙인 조각이 확인된 선수와 시간이 겹치면 떼어 낸다."""
    m = client.post("/api/matches", json={"title": "이름 조각"}).json()
    url = f"/api/matches/{m['id']}"
    client.post(f"{url}/analyze", json={"mode": "sample", "max_seconds": 300})
    home = [p["track_id"] for p in client.get(f"{url}/result").json()["players"] if p["team"] == "home" and not p["minor"]]
    h1, g1, h2, x1 = home[:4]
    for tid, (t0, t1) in {h1: (0, 60), g1: (130, 160), h2: (140, 170), x1: (30, 50)}.items():
        _set_span(m["id"], tid, t0, t1)
    # 자동 정리가 g1을 h1에 짐작으로 붙였다
    from app.database import SessionLocal
    from app.models import MatchPlayer
    db = SessionLocal()
    r = db.query(MatchPlayer).filter(MatchPlayer.match_id == m["id"], MatchPlayer.track_id == g1).one()
    r.merged_into, r.auto_merged = h1, True
    db.commit(); db.close()
    p1 = next(p for p in client.get(f"{url}/result").json()["players"] if p["track_id"] == h1)
    assert p1["merged_from"] == [g1] and p1["guessed_from"] == [g1]

    assert client.patch(f"{url}/players/{h1}", json={"display_name": "김철수"}).status_code == 200
    # x1은 0:30~0:50에 h1과 함께 보였다 → 같은 사람일 수 없다
    r = client.patch(f"{url}/players/{x1}", json={"display_name": "김철수"})
    assert r.status_code == 409 and "0:30" in r.json()["detail"]
    # h2(2:20~2:50)는 확인된 김철수(h1)와 겹치지 않는다 → 합친다. 짐작 조각 g1(2:10~2:40)은 h2와 겹치니 떼어 낸다
    assert client.patch(f"{url}/players/{h2}", json={"display_name": "김철수"}).json()["merged_into"] in (h1, h2)
    after = {p["track_id"]: p for p in client.get(f"{url}/result").json()["players"]}
    kim = next(p for p in after.values() if p["display_name"] == "김철수")
    assert sorted([kim["track_id"], *kim["merged_from"]]) == sorted([h1, h2]) and kim["guessed_from"] == []
    assert g1 in after and after[g1]["display_name"] is None

    # 합쳐진 조각에 다른 이름을 넣으면 그 조각만 떨어져 나와 이름을 받는다
    child = h2 if kim["track_id"] == h1 else h1
    assert client.patch(f"{url}/players/{child}", json={"display_name": "이영희"}).json()["merged_into"] is None
    after = {p["track_id"]: p for p in client.get(f"{url}/result").json()["players"]}
    assert after[child]["display_name"] == "이영희" and after[kim["track_id"]]["merged_from"] == []


def test_confirming_guessed_piece_with_same_name_rejoins(client):
    """물음표 붙은 추정 조각(짐작으로 붙은 조각)을 같은 이름으로 '저장'하면 확인된 연결로 다시 합쳐진다 (예전엔 서버 오류)."""
    m = client.post("/api/matches", json={"title": "추정 확인"}).json()
    url = f"/api/matches/{m['id']}"
    client.post(f"{url}/analyze", json={"mode": "sample", "max_seconds": 300})
    home = [p["track_id"] for p in client.get(f"{url}/result").json()["players"] if p["team"] == "home" and not p["minor"]]
    h1, g1 = home[:2]
    _set_span(m["id"], h1, 0, 60)
    _set_span(m["id"], g1, 100, 160)
    assert client.patch(f"{url}/players/{h1}", json={"display_name": "민호"}).status_code == 200
    from app.database import SessionLocal
    from app.models import MatchPlayer
    db = SessionLocal()
    r = db.query(MatchPlayer).filter(MatchPlayer.match_id == m["id"], MatchPlayer.track_id == g1).one()
    r.merged_into, r.auto_merged = h1, True
    db.commit(); db.close()

    res = client.patch(f"{url}/players/{g1}", json={"display_name": "민호", "jersey_number": None})
    assert res.status_code == 200 and res.json()["merged_into"] in (h1, g1)
    kim = next(p for p in client.get(f"{url}/result").json()["players"] if p["display_name"] == "민호")
    assert sorted([kim["track_id"], *kim["merged_from"]]) == sorted([h1, g1]) and kim["guessed_from"] == []


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


def test_auto_roster_merges_and_undo(client, analyzed):
    """조각으로 나뉜 선수를 팀당 정원 칸으로 합치고, 한 번에 되돌린다."""
    from app.database import SessionLocal
    from app.models import Match, MatchPlayer
    from app.services.result_service import pack_overlay
    url = f"/api/matches/{analyzed}"
    db = SessionLocal()
    rows = db.query(MatchPlayer).filter(MatchPlayer.match_id == analyzed, MatchPlayer.team == "home",
                                        MatchPlayer.merged_into.is_(None), MatchPlayer.excluded.is_(False),
                                        MatchPlayer.display_name.is_(None)).all()
    import json
    rows = [r for r in rows if not (r.label or "").endswith("_gk")]
    assert len(rows) >= 4
    # 옆 위치가 가장 가까운 두 선수를 '한 사람이 화면 밖에 나갔다 돌아온 두 조각'으로 만든다
    rows.sort(key=lambda r: json.loads(r.stats_json).get("avg_y") or 0)
    i = min(range(len(rows) - 1), key=lambda i: abs((json.loads(rows[i + 1].stats_json).get("avg_y") or 0)
                                                     - (json.loads(rows[i].stats_json).get("avg_y") or 0)))
    pa, pb = rows[i], rows[i + 1]
    others = [r for r in rows if r not in (pa, pb)]
    tracks = {r.track_id: [[k, 100 * j, 500, 100 * j + 20, 560] for k in range(0, 300)] for j, r in enumerate(others)}
    tracks[pa.track_id] = [[k, 950, 500, 970, 560] for k in range(0, 100)]
    tracks[pb.track_id] = [[k, 955, 500, 975, 560] for k in range(110, 300)]
    rows = [pa, pb]
    m = db.get(Match, analyzed)
    m.overlay_gz = pack_overlay({"v": 1, "w": 1920, "h": 1080, "start_s": 0, "step": 0.2, "n": 300, "tracks": tracks, "ball": []})
    db.commit()
    a, b = rows[0].track_id, rows[1].track_id
    db.close()
    r = client.post(f"{url}/players/auto-roster")
    assert r.status_code == 200, r.text
    assert r.json()["merged"] >= 1
    heads = {p["track_id"]: p for p in client.get(f"{url}/result").json()["players"]}
    assert (a in heads and b in heads[a]["merged_from"]) or (b in heads and a in heads[b]["merged_from"])
    assert client.post(f"{url}/players/auto-roster/undo").json()["unmerged"] >= 1
    heads = {p["track_id"] for p in client.get(f"{url}/result").json()["players"]}
    assert a in heads and b in heads


def test_ball_label_set_flow(client):
    import json
    from app.database import SessionLocal
    from app.models import BallLabelSet
    db = SessionLocal()
    db.merge(BallLabelSet(id="testset123", title="t", manifest_json=json.dumps(
        {"base": "https://x/", "frames": [{"name": "m3_000001", "burst": 0, "w": 1920, "h": 1080}]})))
    db.commit(); db.close()
    assert client.get("/api/balllabel/nope").status_code == 404
    assert client.put("/api/balllabel/testset123/m3_000001", json={"visible": True, "x": 3000, "y": 10}).status_code == 400
    assert client.put("/api/balllabel/testset123/other", json={"visible": False}).status_code == 404
    assert client.put("/api/balllabel/testset123/m3_000001", json={"visible": True, "x": 960.5, "y": 500}).status_code == 200
    d = client.get("/api/balllabel/testset123").json()
    assert d["labels"]["m3_000001"] == {"visible": True, "x": 960.5, "y": 500}
    client.put("/api/balllabel/testset123/m3_000001", json={"visible": False})
    assert client.get("/api/balllabel/testset123").json()["labels"]["m3_000001"]["visible"] is False


def _rows(match_id):
    from app.database import SessionLocal
    from app.models import MatchPlayer
    db = SessionLocal()
    return db, {r.track_id: r for r in db.query(MatchPlayer).filter(MatchPlayer.match_id == match_id).all()}


def test_naming_piece_of_unnamed_group_names_whole_group_as_guess(client):
    """이름 없는 묶음의 한 조각에 이름을 넣으면 나머지 조각도 그 이름의 추정(물음표)으로 따라온다."""
    m = client.post("/api/matches", json={"title": "묶음 이름"}).json()
    url = f"/api/matches/{m['id']}"
    client.post(f"{url}/analyze", json={"mode": "sample", "max_seconds": 300})
    home = [p["track_id"] for p in client.get(f"{url}/result").json()["players"] if p["team"] == "home" and not p["minor"]]
    h, k1, k2 = home[:3]
    db, rows = _rows(m["id"])
    for k in (k1, k2):
        rows[k].merged_into, rows[k].auto_merged = h, True
    db.commit(); db.close()

    res = client.patch(f"{url}/players/{k1}", json={"display_name": "지훈"})
    assert res.status_code == 200, res.text
    ji = next(p for p in client.get(f"{url}/result").json()["players"] if p["display_name"] == "지훈")
    assert ji["track_id"] == k1 and sorted(ji["merged_from"]) == sorted([h, k2])
    assert sorted(ji["guessed_from"]) == sorted([h, k2])          # 넣은 조각만 확인, 나머지는 추정


def test_move_piece_to_other_team(client):
    """우리 팀으로 잘못 잡힌 상대 선수 조각을 상대 팀으로 옮긴다. 붙어 있던 다른 조각은 원래 팀에 남는다."""
    m = client.post("/api/matches", json={"title": "팀 옮기기"}).json()
    url = f"/api/matches/{m['id']}"
    client.post(f"{url}/analyze", json={"mode": "sample", "max_seconds": 300})
    home = [p["track_id"] for p in client.get(f"{url}/result").json()["players"] if p["team"] == "home" and not p["minor"]]
    h, k1, k2 = home[:3]
    db, rows = _rows(m["id"])
    for k in (k1, k2):
        rows[k].merged_into, rows[k].auto_merged = h, True
    db.commit(); db.close()

    # 묶음 안의 조각 하나만 옮긴다
    assert client.patch(f"{url}/players/{k1}", json={"team": "away"}).status_code == 200
    after = {p["track_id"]: p for p in client.get(f"{url}/result").json()["players"]}
    assert after[k1]["team"] == "away" and after[h]["merged_from"] == [k2]
    # 대표 조각을 옮기면 붙어 있던 조각(k2)은 홈 팀에 따로 남는다
    assert client.patch(f"{url}/players/{h}", json={"team": "away"}).status_code == 200
    after = {p["track_id"]: p for p in client.get(f"{url}/result").json()["players"]}
    assert after[h]["team"] == "away" and after[h]["merged_from"] == []
    assert after[k2]["team"] == "home"


def test_named_goalkeeper_collects_other_gk_pieces(client):
    """이름 붙은 골키퍼에게, 같은 골문 쪽에서 따로 잡힌 이름 없는 골키퍼 조각이 추정으로 붙는다.
    같은 장면에 함께 보인 조각, 반대편 골문 쪽 조각은 붙지 않는다."""
    import json
    from app.models import Match
    from app.services.result_service import pack_overlay
    m = client.post("/api/matches", json={"title": "골키퍼 조각"}).json()
    url = f"/api/matches/{m['id']}"
    client.post(f"{url}/analyze", json={"mode": "sample", "max_seconds": 300})
    home = [p["track_id"] for p in client.get(f"{url}/result").json()["players"] if p["team"] == "home" and not p["minor"]]
    gk, g2, g3, both, far = home[:5]
    db, rows = _rows(m["id"])
    for t in (gk, g2, g3, both, far):
        rows[t].label, rows[t].merged_into, rows[t].display_name = "home_gk", None, None
        st = json.loads(rows[t].stats_json or "{}")
        st["avg_x"] = 0.95 if t == far else 0.05
        rows[t].stats_json = json.dumps(st)
    tracks = {gk: [[k, 10, 500, 30, 560] for k in range(0, 100)],
              g2: [[k, 10, 500, 30, 560] for k in range(110, 200)],
              g3: [[k, 10, 500, 30, 560] for k in range(210, 300)],
              both: [[k, 40, 500, 60, 560] for k in range(50, 90)],      # gk와 같은 장면에 함께 보였다
              far: [[k, 1800, 500, 1820, 560] for k in range(300, 350)]}
    db.get(Match, m["id"]).overlay_gz = pack_overlay({"v": 1, "w": 1920, "h": 1080, "start_s": 0, "step": 0.2,
                                                      "n": 400, "tracks": tracks, "ball": []})
    db.commit(); db.close()

    assert client.patch(f"{url}/players/{gk}", json={"display_name": "경민"}).status_code == 200
    kim = next(p for p in client.get(f"{url}/result").json()["players"] if p["display_name"] == "경민")
    assert sorted(kim["merged_from"]) == sorted([g2, g3]) and sorted(kim["guessed_from"]) == sorted([g2, g3])


def test_match_lineup_saved_per_side(client):
    """경기 명단: 팀별 이름 목록을 저장하고, 한쪽만 보내면 다른 쪽은 그대로 둔다."""
    m = client.post("/api/matches", json={"title": "명단"}).json()
    url = f"/api/matches/{m['id']}"
    assert m["lineup"] == {}
    r = client.patch(url, json={"lineup": {"home": [" 강석 ", "정건", "강석", ""]}})
    assert r.status_code == 200 and r.json()["lineup"] == {"home": ["강석", "정건"]}
    r = client.patch(url, json={"lineup": {"away": ["상대1"]}})
    assert r.json()["lineup"] == {"home": ["강석", "정건"], "away": ["상대1"]}


def test_same_name_allowed_when_never_on_screen_together(client):
    """처음~마지막 시각은 겹쳐도 실제로 같은 장면에 함께 잡힌 적이 없으면 같은 이름으로 합친다.
    함께 잡힌 적이 있으면 막고, 그 시간을 알려 준다."""
    from app.models import Match
    from app.services.result_service import pack_overlay
    m = client.post("/api/matches", json={"title": "장면 겹침"}).json()
    url = f"/api/matches/{m['id']}"
    client.post(f"{url}/analyze", json={"mode": "sample", "max_seconds": 300})
    home = [p["track_id"] for p in client.get(f"{url}/result").json()["players"] if p["team"] == "home" and not p["minor"]]
    a, b, c = home[:3]
    for t in (a, b, c):
        _set_span(m["id"], t, 0, 100)                 # 시각만 보면 셋 다 겹친다
    db, rows = _rows(m["id"])
    for t in (a, b, c):
        rows[t].merged_into, rows[t].display_name = None, None
    tracks = {a: [[k, 10, 500, 30, 560] for k in range(0, 100)],
              b: [[k, 10, 500, 30, 560] for k in range(200, 300)],      # a가 화면 밖으로 나간 뒤에만 보였다
              c: [[k, 900, 500, 920, 560] for k in range(250, 400)]}    # b와 같은 장면에 함께 보였다
    db.get(Match, m["id"]).overlay_gz = pack_overlay({"v": 1, "w": 1920, "h": 1080, "start_s": 0, "step": 0.2,
                                                      "n": 500, "tracks": tracks, "ball": []})
    db.commit(); db.close()
    assert client.patch(f"{url}/players/{a}", json={"display_name": "준수"}).status_code == 200
    assert client.patch(f"{url}/players/{b}", json={"display_name": "준수"}).status_code == 200
    r = client.patch(f"{url}/players/{c}", json={"display_name": "준수"})
    assert r.status_code == 409 and "0:50~0:59" in r.json()["detail"]
