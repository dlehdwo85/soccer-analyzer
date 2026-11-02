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
