"""다시 분석해도 사람이 해 둔 작업이 남는지 — 이름·등번호·역할·제외·합치기·이벤트 검수를 화면 위치로 이어 옮긴다."""

import json
import os
import tempfile

import pytest

_tmp = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/test.db"
os.environ["UPLOAD_DIR"] = os.path.join(_tmp, "uploads")

from fastapi.testclient import TestClient  # noqa: E402

from app.database import SessionLocal  # noqa: E402
from app.models import Match, MatchEvent, MatchPlayer  # noqa: E402
from app.services import carryover_service as co  # noqa: E402
from app.services.result_service import save_result  # noqa: E402
from app.vision.stats import empty_stats  # noqa: E402
from main import app  # noqa: E402

NOTHING_LOST = {"names": 0, "roles": 0, "manual_events": 0, "event_edits": 0}


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def _ov(tracks, w=1920, h=1080, step=1 / 6, start_s=0.0, end_s=60.0, speed=0.0005):
    """tracks: {트랙: (가로 위치 0~1, 처음 보인 영상 시각, 마지막 시각)} — 각자 자기 자리에서 오른쪽으로 움직인다."""
    n = int(round((end_s - start_s) / step)) + 1
    out = {}
    for pid, (x, t0, t1) in tracks.items():
        out[pid] = []
        for k in range(n):
            t = start_s + k * step
            if t0 <= t <= t1:
                cx = x + speed * t
                out[pid].append([k, round((cx - 0.012) * w), round(0.40 * h), round((cx + 0.012) * w), round(0.51 * h)])
    return {"v": 1, "w": w, "h": h, "start_s": start_s, "step": step, "n": n, "tracks": out, "ball": []}


def _result(players, overlay, events=(), slots=None):
    """players: {트랙: (팀, 라벨, 잡힌 시간)}"""
    return {"version": 2, "overlay": overlay, "events": list(events),
            "meta": {"source": "video", "duration_s": 60.0, "roster_slots": slots or {}},
            "players": [{"track_id": pid, "team": team, "label": label, "minor": False,
                         "stats": dict(empty_stats(), seconds_tracked=s, first_seen_s=0.0, last_seen_s=s)}
                        for pid, (team, label, s) in players.items()]}


def _shot(t, team, player):
    return {"kind": "shot", "t": t, "t_end": t, "team": team, "player": player, "detail": {"outcome": "off_target"}}


def _match(client, title):
    return client.post("/api/matches", json={"title": title}).json()["id"]


def _save(mid, res):
    db = SessionLocal()
    save_result(db, db.get(Match, mid), res, "video")
    db.commit()
    db.close()


def _rows(mid):
    db = SessionLocal()
    rows = {r.track_id: r for r in db.query(MatchPlayer).filter(MatchPlayer.match_id == mid).all()}
    db.close()
    return rows


def _view(client, mid):
    res = client.get(f"/api/matches/{mid}/result").json()
    return res, {p["track_id"]: p for p in res["players"]}


def test_names_roles_and_events_survive_reanalysis(client):
    """트랙 번호·화면 크기·장면 간격·분석 시작 시각이 모두 달라져도 같은 자리의 선수로 옮겨진다."""
    mid = _match(client, "다시 분석")
    url = f"/api/matches/{mid}"
    old = {"P1": (.10, 0, 28), "P2": (.10, 30, 60), "P3": (.20, 0, 60), "P4": (.30, 0, 60), "P5": (.40, 0, 60),
           "P6": (.50, 0, 60), "P7": (.60, 0, 60), "P8": (.70, 0, 60)}
    _save(mid, _result({"P1": ("home", "home", 28), "P2": ("home", "home", 30), "P3": ("home", "home", 60),
                        "P4": ("away", "away", 60), "P5": ("away", "away", 60), "P6": ("home", "home", 60),
                        "P7": ("away", "away", 60), "P8": ("home", "home", 60)},
                       _ov(old), [_shot(20.0, "away", "P7"), _shot(40.0, "home", "P8")]))
    # 사람이 한 작업: 조각 합치기, 이름·등번호, 골키퍼, 심판, 제외, 이벤트 지우기·고치기·추가
    assert client.post(f"{url}/players/merge", json={"target": "P1", "sources": ["P2"]}).status_code == 200
    client.patch(f"{url}/players/P1", json={"display_name": "김철수", "jersey_number": 10})
    client.patch(f"{url}/players/P3", json={"display_name": "이영희", "jersey_number": 7})
    client.patch(f"{url}/players/P4", json={"role": "gk"})
    client.patch(f"{url}/players/P5", json={"role": "referee"})
    client.patch(f"{url}/players/P6", json={"excluded": True})
    shots = {e["player"]: e["id"] for e in client.get(f"{url}/result").json()["events"]}
    assert client.patch(f"{url}/events/{shots['P7']}", json={"deleted": True}).status_code == 200
    assert client.patch(f"{url}/events/{shots['P8']}", json={"result": "on_target"}).status_code == 200
    assert client.post(f"{url}/events", json={"kind": "pass", "t": 30.0, "player": "P3", "target": "P8"}).status_code == 201

    # 새 분석: 영상 5초부터, 1280x720, 초당 15장면, 번호는 전부 다름. 김철수는 두 조각(Q11·Q12)으로 잡혔다
    new = {"Q11": (.10, 5, 18), "Q12": (.10, 20, 60), "Q13": (.20, 5, 60), "Q14": (.30, 5, 60), "Q15": (.40, 5, 60),
           "Q16": (.50, 5, 60), "Q17": (.60, 5, 60), "Q18": (.70, 5, 60), "Q19": (.85, 5, 60)}
    _save(mid, _result({"Q11": ("home", "home", 13), "Q12": ("home", "home", 40), "Q13": ("home", "home", 55),
                        "Q14": ("away", "away", 55), "Q15": ("away", "away", 55), "Q16": ("home", "home", 55),
                        "Q17": ("away", "away", 55), "Q18": ("home", "home", 55), "Q19": ("home", "home", 55)},
                       _ov(new, w=1280, h=720, step=1 / 15, start_s=5.0),
                       [_shot(15.4, "away", "Q17"), _shot(34.2, "home", "Q18"), _shot(50.0, "away", "Q17")]))
    res, ps = _view(client, mid)
    assert ps["Q12"]["display_name"] == "김철수" and ps["Q12"]["jersey_number"] == 10 and ps["Q12"]["merged_from"] == ["Q11"]
    assert ps["Q13"]["display_name"] == "이영희" and ps["Q13"]["jersey_number"] == 7
    assert ps["Q14"]["label"] == "away_gk" and not ps["Q14"]["excluded"]
    assert ps["Q15"]["label"] == "referee" and ps["Q15"]["excluded"]
    assert ps["Q16"]["excluded"] and ps["Q16"]["label"] == "home"
    assert not ps["Q17"]["excluded"] and ps["Q19"]["display_name"] is None and ps["Q19"]["merged_from"] == []
    # 이벤트: 지운 슈팅은 지워진 채, 고친 슈팅은 유효 슈팅, 직접 넣은 패스는 새 번호와 새 시각(5초 당겨짐)으로
    ev = {(e["kind"], e["t"]): e for e in res["events"]}
    assert set(ev) == {("shot", 34.2), ("shot", 50.0), ("pass", 25.0)}
    assert ev[("shot", 34.2)]["success"] is True and ev[("shot", 34.2)]["edited"] and ev[("shot", 34.2)]["player"] == "Q18"
    assert not ev[("shot", 50.0)]["edited"]
    p = ev[("pass", 25.0)]
    assert p["manual"] and p["player"] == "Q13" and p["target"] == "Q18" and p["success"] is True and p["team"] == "home"
    assert res["meta"]["carried_over"] == {"names": 2, "roles": 3, "teams": 0, "merges": 1, "manual_events": 1,
                                           "event_edits": 2, "unmatched": NOTHING_LOST}
    # 옮겨 온 합치기는 '자동 정리 되돌리기'에 풀리지 않는다
    assert client.post(f"{url}/players/auto-roster/undo").json()["unmerged"] == 0
    assert _rows(mid)["Q11"].merged_into == "Q12"
    # 지운 이벤트 되살리기(초기화)도 그대로 동작한다
    client.post(f"{url}/events/reset")
    assert {(e["kind"], e["t"]) for e in client.get(f"{url}/result").json()["events"]} == {
        ("shot", 15.4), ("shot", 34.2), ("shot", 50.0)}


def test_two_named_players_never_merge_and_engine_slots_follow(client):
    mid = _match(client, "이름 둘")
    url = f"/api/matches/{mid}"
    home = lambda s: ("home", "home", s)  # noqa: E731
    _save(mid, _result({"A": home(60), "B": home(60), "C": home(60)}, _ov({"A": (.1, 0, 60), "B": (.2, 0, 60), "C": (.3, 0, 60)})))
    client.patch(f"{url}/players/A", json={"display_name": "가"})
    client.patch(f"{url}/players/B", json={"display_name": "나"})
    # 새 엔진이 가·나와 모르는 조각(QC)을 한 칸에 묶었다 → 이름 붙은 둘은 갈라지고, QC는 어느 쪽에도 붙지 않는다
    _save(mid, _result({"QA": home(60), "QB": home(50), "QC": home(20)},
                       _ov({"QA": (.1, 0, 60), "QB": (.2, 0, 60), "QC": (.9, 0, 60)}), slots={"QB": "QA", "QC": "QA"}))
    res, ps = _view(client, mid)
    assert ps["QA"]["display_name"] == "가" and ps["QB"]["display_name"] == "나"
    assert ps["QA"]["merged_from"] == ps["QB"]["merged_from"] == ps["QC"]["merged_from"] == []
    assert ps["QC"]["display_name"] is None
    assert res["meta"]["carried_over"]["names"] == 2

    # 또 다시 분석: 엔진 칸의 대표가 모르는 조각(RC)이어도 이름은 직접 이어진 트랙(RA)에 붙고, RC는 따라온다
    _save(mid, _result({"RA": home(30), "RC": home(60)}, _ov({"RA": (.1, 0, 60), "RC": (.9, 0, 60)}), slots={"RA": "RC"}))
    res, ps = _view(client, mid)
    assert set(ps) == {"RA"} and ps["RA"]["display_name"] == "가" and ps["RA"]["merged_from"] == ["RC"]
    assert res["meta"]["carried_over"]["unmatched"]["names"] == 1 and res["meta"]["carried_over"]["lost_names"] == ["나"]
    # 따라온 엔진 조각은 되돌리기로 풀린다. 이름은 그대로
    assert client.post(f"{url}/players/auto-roster/undo").json()["unmerged"] == 1
    _, ps = _view(client, mid)
    assert set(ps) == {"RA", "RC"} and ps["RA"]["display_name"] == "가" and ps["RC"]["display_name"] is None


def test_missing_overlay_or_other_video_carries_nothing(client):
    mid = _match(client, "오버레이 없음")
    url = f"/api/matches/{mid}"
    tracks = {"A": (.1, 0, 60), "B": (.5, 0, 60)}
    players = {"A": ("home", "home", 60), "B": ("away", "away", 60)}
    _save(mid, _result(players, None, [_shot(10.0, "home", "A")]))            # 옛 엔진: 오버레이 없음
    assert "carried_over" not in client.get(f"{url}/result").json()["meta"]   # 처음 분석엔 옮길 것이 없다
    client.patch(f"{url}/players/A", json={"display_name": "가"})
    _save(mid, _result(players, _ov(tracks), [_shot(10.0, "home", "A")]))
    res, ps = _view(client, mid)
    assert ps["A"]["display_name"] is None and res["meta"]["carried_over"] == {"skipped": "no_overlay"}

    client.patch(f"{url}/players/A", json={"display_name": "가"})
    _save(mid, _result(players, None))                                        # 새 결과에 오버레이가 없다
    res, ps = _view(client, mid)
    assert ps["A"]["display_name"] is None and res["meta"]["carried_over"] == {"skipped": "no_overlay"}

    # 전혀 다른 자리(다른 영상): 이름도, 지운 이벤트도 옮기지 않는다
    _save(mid, _result(players, _ov(tracks), [_shot(10.0, "home", "A")]))
    client.patch(f"{url}/players/A", json={"display_name": "가"})
    eid = client.get(f"{url}/result").json()["events"][0]["id"]
    client.patch(f"{url}/events/{eid}", json={"deleted": True})
    _save(mid, _result({"X": ("home", "home", 60), "Y": ("away", "away", 60)}, _ov({"X": (.3, 0, 60), "Y": (.8, 0, 60)}),
                       [_shot(10.0, "home", "X")]))
    res, ps = _view(client, mid)
    assert ps["X"]["display_name"] is None and len(res["events"]) == 1
    assert res["meta"]["carried_over"] == {"skipped": "no_match"}


def test_carryover_failure_still_saves_plain_result(client, monkeypatch):
    mid = _match(client, "옮기다 실패")
    url = f"/api/matches/{mid}"
    tracks = {"A": (.1, 0, 60), "B": (.5, 0, 60)}
    _save(mid, _result({"A": ("home", "home", 60), "B": ("away", "away", 60)}, _ov(tracks)))
    client.patch(f"{url}/players/A", json={"display_name": "가"})
    client.patch(f"{url}/players/B", json={"excluded": True})

    def boom(*a, **k):
        raise RuntimeError("일부러 낸 오류")
    monkeypatch.setattr(co, "_carry_events", boom)   # 선수는 이미 옮긴 뒤에 터진다 → 그것까지 되돌려야 한다
    _save(mid, _result({"QA": ("home", "home", 60), "QB": ("away", "away", 60)},
                       _ov({"QA": (.1, 0, 60), "QB": (.5, 0, 60)}), [_shot(10.0, "home", "QA")]))
    res, ps = _view(client, mid)
    assert set(ps) == {"QA", "QB"} and ps["QA"]["display_name"] is None and not ps["QB"]["excluded"]
    assert len(res["events"]) == 1 and res["meta"]["carried_over"] == {"skipped": "error"}
    assert client.get(f"{url}/status").json()["status"] == "done"
    monkeypatch.undo()
    # 오버레이가 깨져 있어도 저장은 된다
    db = SessionLocal()
    db.get(Match, mid).overlay_gz = "깨진 값"
    db.commit(); db.close()
    client.patch(f"{url}/players/QA", json={"display_name": "가"})
    _save(mid, _result({"RA": ("home", "home", 60)}, _ov({"RA": (.1, 0, 60)})))
    res, ps = _view(client, mid)
    assert set(ps) == {"RA"} and res["meta"]["carried_over"] == {"skipped": "error"}


def test_goalkeeper_team_follows_user_and_colour_swap(client):
    mid = _match(client, "골키퍼 팀")
    url = f"/api/matches/{mid}"
    pos = {1: .1, 2: .2, 3: .3, 4: .4, 5: .5}
    teams = {1: "home", 2: "home", 3: "away", 4: "away", 5: "away"}
    mk = lambda pre, tm: (_result({f"{pre}{i}": (tm[i], tm[i], 60) for i in pos},  # noqa: E731
                                  _ov({f"{pre}{i}": (x, 0, 60) for i, x in pos.items()})))
    _save(mid, mk("P", teams))
    client.patch(f"{url}/players/P1", json={"display_name": "가"})
    client.patch(f"{url}/players/P5", json={"team": "home"})     # 엔진이 상대 팀으로 잡은 우리 골키퍼를 고침
    client.patch(f"{url}/players/P5", json={"role": "gk"})
    _save(mid, mk("Q", teams))                                    # 엔진은 또 원정으로 잡는다
    res, ps = _view(client, mid)
    assert ps["Q5"]["team"] == "home" and ps["Q5"]["label"] == "home_gk" and ps["Q1"]["team"] == "home"
    assert res["meta"]["carried_over"]["teams"] == 1 and res["meta"]["carried_over"]["roles"] == 1
    # 팀 색을 바꿔 다시 분석해 홈·원정이 통째로 뒤집혔다 → 옛 팀을 고집하지 않고 뒤집힌 쪽을 따라간다
    flipped = {i: ("away" if t == "home" else "home") for i, t in teams.items()}
    _save(mid, mk("R", flipped))
    _, ps = _view(client, mid)
    assert ps["R1"]["team"] == "away" and ps["R1"]["display_name"] == "가"
    assert ps["R5"]["team"] == "away" and ps["R5"]["label"] == "away_gk"   # 가와 같은 팀의 골키퍼
    assert ps["R3"]["team"] == "home"


def test_manual_event_falls_back_or_is_dropped(client):
    """이벤트 시각에 그 선수가 화면에 없으면 그 선수를 이어받은 새 선수로, 이어받은 선수가 없으면 버리고 센다."""
    mid = _match(client, "이벤트 옮기기")
    url = f"/api/matches/{mid}"
    home = lambda s: ("home", "home", s)  # noqa: E731
    _save(mid, _result({"A": home(60), "B": home(60), "C": home(60)},
                       _ov({"A": (.1, 0, 40), "B": (.3, 0, 60), "C": (.5, 0, 60)})))
    for t, player, target in ((50.0, "A", "B"), (20.0, "C", "B"), (30.0, "B", None)):
        body = {"kind": "pass", "t": t, "player": player, **({"target": target} if target else {})}
        assert client.post(f"{url}/events", json=body).status_code == 201
    # 새 분석에는 C 자리에 아무도 없다
    _save(mid, _result({"QA": home(60), "QB": home(60)}, _ov({"QA": (.1, 0, 40), "QB": (.3, 0, 60)})))
    res, _ = _view(client, mid)
    ev = {e["t"]: e for e in res["events"]}
    assert set(ev) == {50.0, 30.0}
    assert ev[50.0]["player"] == "QA" and ev[50.0]["target"] == "QB" and ev[50.0]["manual"]   # 50초엔 A가 화면에 없었다
    assert ev[30.0]["player"] == "QB" and ev[30.0]["target"] is None
    assert res["meta"]["carried_over"]["manual_events"] == 2
    assert res["meta"]["carried_over"]["unmatched"]["manual_events"] == 1
    db = SessionLocal()
    seqs = [s for (s,) in db.query(MatchEvent.seq).filter(MatchEvent.match_id == mid).all()]
    db.close()
    assert len(seqs) == len(set(seqs)) == 2


def test_match_tracks_rule():
    heads = {"A": "A", "B": "B"}
    # 빨리 달리는 선수(0.5초에 박스 하나 너비)도 장면 시각이 어긋난 두 분석 사이에서 이어진다
    old = co._Ov(_ov({"A": (.1, 0, 30)}, speed=0.05, end_s=30))
    new = co._Ov(_ov({"N": (.1, 0, 30)}, w=1280, h=720, step=1 / 15, start_s=0.03, speed=0.05, end_s=30))
    assert co.match_tracks(old, new, heads)["N"][0] == "A"
    # 새 트랙 표본의 40% 이상이 한 옛 선수와 겹쳐야 한다
    new = co._Ov(_ov({"N": (.1, 0, 60)}))
    assert "N" not in co.match_tracks(co._Ov(_ov({"A": (.1, 0, 18)})), new, heads)
    assert co.match_tracks(co._Ov(_ov({"A": (.1, 0, 30)})), new, heads)["N"][0] == "A"
    # 옛 분석이 더 짧았으면(30초까지) 그 구간에서만 비교한다
    assert co.match_tracks(co._Ov(_ov({"A": (.1, 0, 30)}, end_s=30)), new, heads)["N"] == ("A", 40)
    # 조각난 옛 트랙이 한 선수로 합쳐져 있었으면 표를 합쳐서 센다
    pieces = co._Ov(_ov({"A": (.1, 0, 15), "B": (.1, 30, 45)}))
    assert "N" not in co.match_tracks(pieces, new, heads)
    assert co.match_tracks(pieces, new, {"A": "A", "B": "A"})["N"][0] == "A"
    # 옆 선수(겹치지 않는 자리)와는 이어지지 않는다
    assert co.match_tracks(co._Ov(_ov({"A": (.14, 0, 60)})), new, heads) == {}


def test_matching_is_fast_on_a_full_match():
    """트랙 300개·16,000장면(선수 22명이 계속 화면에 있는 45분)도 금방 끝난다."""
    import time
    n, tracks = 16000, {}
    for i in range(300):
        k0 = (i // 22) * (n // 14)
        x, y = 60 + (i % 22) * 80, 300 + (i % 5) * 40
        tracks[f"P{i}"] = [[k, x + k % 7, y, x + 30 + k % 7, y + 90] for k in range(k0, min(n, k0 + n // 14))]
    old = co._Ov({"w": 1920, "h": 1080, "start_s": 0, "step": 1 / 6, "n": n, "tracks": tracks})
    new = co._Ov({"w": 1920, "h": 1080, "start_s": 0, "step": 1 / 6, "n": n,
                  "tracks": {"Q" + k[1:]: v for k, v in tracks.items()}})
    t0 = time.perf_counter()
    found = co.match_tracks(old, new, {})
    assert time.perf_counter() - t0 < 20.0   # 느린 컴퓨터에서도 1~2초 — 표본 수를 묶어 두지 않으면 분 단위가 된다
    assert len(found) == 300 and all(g == "P" + q[1:] for q, (g, _) in found.items())
    assert json.dumps(found)   # 요약에 넣을 수 있는 값만


def test_same_track_ids_can_be_different_people(client):
    """두 분석의 트랙 번호가 우연히 같아도 번호가 아니라 자리로 잇는다. 엔진이 붙인 골키퍼 표시만 있으면 옮겼다고 하지 않는다."""
    mid = _match(client, "같은 번호")
    url = f"/api/matches/{mid}"
    _save(mid, _result({"P1": ("home", "home", 60), "P2": ("home", "home_gk", 60)}, _ov({"P1": (.1, 0, 60), "P2": (.5, 0, 60)})))
    _save(mid, _result({"P1": ("home", "home_gk", 60), "P2": ("home", "home", 60)}, _ov({"P1": (.5, 0, 60), "P2": (.1, 0, 60)})))
    res, ps = _view(client, mid)
    assert "carried_over" not in res["meta"] and ps["P1"]["label"] == "home_gk"   # 사람이 한 작업이 없다
    client.patch(f"{url}/players/P2", json={"display_name": "가"})                 # 지금 P2는 왼쪽(.1) 선수
    _save(mid, _result({"P1": ("home", "home", 60), "P2": ("home", "home_gk", 28), "P3": ("home", "home_gk", 30)},
                       _ov({"P1": (.1, 0, 60), "P2": (.5, 0, 28), "P3": (.5, 30, 60)})))
    res, ps = _view(client, mid)
    assert ps["P1"]["display_name"] == "가" and ps["P1"]["label"] == "home"
    # 골키퍼 조각 둘(P2·P3)은 옛 골키퍼 한 명에 이어져 묶이지만, 사람이 묶은 것이 아니므로 되돌리기로 풀린다
    assert ps["P3"]["merged_from"] == ["P2"] and ps["P3"]["label"] == "home_gk"
    assert res["meta"]["carried_over"]["names"] == 1 and res["meta"]["carried_over"]["merges"] == 0
    assert client.post(f"{url}/players/auto-roster/undo").json()["unmerged"] == 1


def test_guessed_pieces_of_named_player_stay_guesses(client):
    """이름 붙은 선수에 자동 정리가 짐작으로 붙인 조각은 다시 분석해도 '확인된' 합치기가 되지 않는다.
    (2쿼터 v2.6.0 재분석: 강석 23조각 중 21조각이 짐작이었는데 전부 확인됨으로 굳어 다른 사람에게 이름이 붙었다)"""
    mid = _match(client, "짐작 조각")
    url = f"/api/matches/{mid}"
    home = lambda s: ("home", "home", s)  # noqa: E731
    # A(0~30초) 이름 '가', G(31~60초)는 자동 정리가 A에 짐작으로 붙였다(실제로는 다른 사람)
    _save(mid, _result({"A": home(30), "G": home(29)}, _ov({"A": (.1, 0, 30), "G": (.5, 31, 60)}), slots={"G": "A"}))
    client.patch(f"{url}/players/A", json={"display_name": "가"})
    _, ps = _view(client, mid)
    assert ps["A"]["guessed_from"] == ["G"]
    # 같은 화면으로 다시 분석: 새 엔진은 G 자리 조각(NG)을 따로 둔다
    _save(mid, _result({"NA": home(30), "NG": home(29)}, _ov({"NA": (.1, 0, 30), "NG": (.5, 31, 60)})))
    _, ps = _view(client, mid)
    assert ps["NA"]["display_name"] == "가" and ps["NA"]["merged_from"] == []
    assert ps["NG"]["display_name"] is None
    # 새 엔진이 NG를 NA에 다시 짐작으로 붙이면 그대로 '추정'으로 남는다
    _save(mid, _result({"MA": home(30), "MG": home(29)}, _ov({"MA": (.1, 0, 30), "MG": (.5, 31, 60)}), slots={"MG": "MA"}))
    _, ps = _view(client, mid)
    assert ps["MA"]["display_name"] == "가" and ps["MA"]["guessed_from"] == ["MG"]
