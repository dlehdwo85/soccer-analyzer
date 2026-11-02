"""RunPod 비동기 연동 — 제출·상태 조회·R2 결과 내려받기 (네트워크는 가짜로 대체)."""

import gzip
import json

import pytest

from app.services import runpod_service as rs
from app.vision.pipeline import AnalysisConfig, QUALITY_PRESETS, pack_result


class _Resp:
    def __init__(self, data=None, content=b"", status=200):
        self._data, self.content, self.status_code = data, content, status

    def json(self):
        return self._data

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(self.status_code)


@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setenv("RUNPOD_API_KEY", "k")
    monkeypatch.setenv("RUNPOD_ENDPOINT_ID", "ep")
    for k in ("R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("R2_PUBLIC_URL", "https://pub.example")


def test_submit_sends_result_key(configured, monkeypatch):
    sent = {}

    def fake_post(url, json=None, headers=None, timeout=None):
        sent.update(url=url, body=json)
        return _Resp({"id": "job-1"})
    monkeypatch.setattr(rs.requests, "post", fake_post)
    assert rs.submit_job("https://v/x.mp4", {"quality": "max"}, "results/1/a.json.gz") == "job-1"
    assert sent["url"].endswith("/ep/run")
    assert sent["body"]["input"]["result_key"] == "results/1/a.json.gz"
    assert sent["body"]["input"]["config"]["quality"] == "max"


def test_check_job_states_and_r2_result(configured, monkeypatch):
    result = {"version": 2, "players": [], "events": [], "meta": {"ball_detected_pct": 90}}
    blob = gzip.compress(json.dumps(result).encode())
    replies = iter([
        _Resp({"status": "IN_QUEUE"}),
        _Resp({"status": "IN_PROGRESS", "output": {"percent": 42.0, "message": "선수·공 검출 중"}}),
        _Resp({"status": "COMPLETED", "output": {"status": "done", "result_key": "results/1/a.json.gz"}}),
    ])

    def fake_get(url, headers=None, timeout=None):
        if url.startswith("https://pub.example/"):
            assert url == "https://pub.example/results/1/a.json.gz"
            return _Resp(content=blob)
        return next(replies)
    monkeypatch.setattr(rs.requests, "get", fake_get)
    assert rs.check_job("job-1")["state"] == "queued"
    st = rs.check_job("job-1")
    assert st["state"] == "running" and st["percent"] == 42.0
    done = rs.check_job("job-1")
    assert done["state"] == "done" and done["result"]["meta"]["ball_detected_pct"] == 90


def test_check_job_inline_result_and_failure(configured, monkeypatch):
    result = {"version": 2, "players": [], "events": [], "meta": {}}
    replies = iter([
        _Resp({"status": "COMPLETED", "output": {"status": "done", "result_gz": pack_result(result)}}),
        _Resp({"status": "COMPLETED", "output": {"status": "failed", "error": "영상을 열 수 없습니다"}}),
        _Resp({"status": "FAILED", "error": "OOM"}),
    ])
    monkeypatch.setattr(rs.requests, "get", lambda *a, **k: next(replies))
    assert rs.check_job("j")["result"]["version"] == 2
    f1 = rs.check_job("j")
    assert f1["state"] == "failed" and "영상을 열 수 없습니다" in f1["error"]
    f2 = rs.check_job("j")
    assert f2["state"] == "failed" and "FAILED" in f2["error"]


def test_quality_presets():
    assert AnalysisConfig().effective_fps() == 6.0
    assert AnalysisConfig(quality="max").effective_fps() == QUALITY_PRESETS["max"]["analysis_fps"]
    assert AnalysisConfig(quality="max", analysis_fps=25).effective_fps() == 25
    assert AnalysisConfig.from_dict({"quality": "max", "unknown": 1}).quality == "max"


def test_api_gpu_flow_submit_then_poll_saves_result(monkeypatch):
    """분석 시작 → GPU 작업 제출(즉시 반환) → 상태 조회 때 진행률 → 완료 시 결과 저장."""
    import os
    import tempfile
    os.environ.setdefault("DATABASE_URL", f"sqlite:///{tempfile.mkdtemp()}/gpu.db")
    from fastapi.testclient import TestClient
    from main import app
    from app.vision.pipeline import analyze_simulated

    monkeypatch.setenv("RUNPOD_API_KEY", "k")
    monkeypatch.setenv("RUNPOD_ENDPOINT_ID", "ep")
    submitted = {}

    def fake_submit(video_url, config, result_key=None):
        submitted.update(url=video_url, config=config, key=result_key)
        return "job-9"
    states = iter([
        {"state": "running", "percent": 37.0, "message": "선수·공 검출 중"},
        {"state": "done", "result": analyze_simulated(AnalysisConfig(), duration_s=60, seed=5)},
    ])
    monkeypatch.setattr(rs, "submit_job", fake_submit)
    monkeypatch.setattr(rs, "check_job", lambda job_id: next(states))

    with TestClient(app) as c:
        mid = c.post("/api/matches", json={"title": "GPU 경기"}).json()["id"]
        c.post(f"/api/matches/{mid}/set-video-url", json={"video_url": "https://pub.example/v.mp4", "filename": "v.mp4"})
        r = c.post(f"/api/matches/{mid}/analyze", json={"mode": "video", "quality": "max"})
        assert r.status_code == 200 and r.json()["engine"] == "runpod", r.text
        assert submitted["config"]["quality"] == "max" and submitted["key"].startswith(f"results/{mid}/")
        s1 = c.get(f"/api/matches/{mid}/status").json()
        assert s1["status"] == "analyzing" and s1["progress"] == 37.0 and "검출" in s1["message"]
        s2 = c.get(f"/api/matches/{mid}/status").json()
        assert s2["status"] == "done" and s2["has_result"] is True
        assert c.get(f"/api/matches/{mid}/result").status_code == 200


def test_api_max_quality_requires_gpu(monkeypatch):
    from fastapi.testclient import TestClient
    from main import app
    monkeypatch.delenv("RUNPOD_API_KEY", raising=False)
    monkeypatch.delenv("RUNPOD_ENDPOINT_ID", raising=False)
    with TestClient(app) as c:
        mid = c.post("/api/matches", json={"title": "CPU 경기"}).json()["id"]
        c.post(f"/api/matches/{mid}/set-video-url", json={"video_url": "https://pub.example/v.mp4", "filename": "v.mp4"})
        r = c.post(f"/api/matches/{mid}/analyze", json={"mode": "video", "quality": "max"})
        assert r.status_code in (400, 503), r.text
