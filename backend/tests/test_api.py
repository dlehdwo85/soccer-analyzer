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
    for k in ("touches", "passes_completed", "passes_failed", "shots_on_target", "xg", "distance_m",
              "sprint_m", "top_speed_kmh", "heat", "pass_accuracy"):
        assert k in p
    assert res["pass_network"]["home"]["nodes"]
    assert res["possession_timeline"]
    assert res["possessions"]


def test_merge_unmerge_exclude_and_team_change(client, analyzed):
    url = f"/api/matches/{analyzed}"
    before = client.get(f"{url}/result").json()
    home = [p for p in before["players"] if p["team"] == "home" and p["label"] == "home"]
    a, b = home[0], home[1]
    dist_sum = a["stats"]["distance_m"] + b["stats"]["distance_m"]

    r = client.post(f"{url}/players/merge", json={"target": a["track_id"], "sources": [b["track_id"]]})
    assert r.status_code == 200
    after = client.get(f"{url}/result").json()
    assert len(after["players"]) == len(before["players"]) - 1
    merged = next(p for p in after["players"] if p["track_id"] == a["track_id"])
    assert merged["merged_from"] == [b["track_id"]]
    assert merged["stats"]["distance_m"] == pytest.approx(dist_sum, abs=0.01)
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


def test_gps_upload(client):
    mid = client.post("/api/matches", json={"title": "gps"}).json()["id"]
    rows = ["timestamp_ms,player_id,player_name,jersey_number,lat,lng,speed_mps,team"]
    for i in range(600):  # 1Hz 10분, 두 선수
        rows.append(f"{i * 1000},p1,김철수,10,{37.5 + i * 0.00002:.7f},{127.0 + (i % 60) * 0.00003:.7f},3,home")
        rows.append(f"{i * 1000},p2,이영희,4,{37.5003:.7f},{127.0 + (i % 30) * 0.00001:.7f},1,away")
    content = "\n".join(rows).encode()
    pv = client.post(f"/api/matches/{mid}/gps-preview", files={"file": ("g.csv", content, "text/csv")})
    assert pv.status_code == 200 and pv.json()["total_players"] == 2
    r = client.post(f"/api/matches/{mid}/upload-gps", files={"file": ("g.csv", content, "text/csv")})
    assert r.status_code == 200, r.text
    res = client.get(f"/api/matches/{mid}/result").json()
    assert res["match"]["data_source"] == "gps"
    p1 = next(p for p in res["players"] if p["display_name"] == "김철수")
    assert p1["jersey_number"] == 10 and p1["stats"]["distance_m"] > 300
    assert p1["stats"]["touches"] == 0 and res["events"] == []


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
