"""AI 경기 요약 — 팀 기록과 주요 선수 기록만 Claude에 넘겨 '무엇이 승부를 갈랐나'와 MOM 후보를 받는다.

build_match_context()는 결과 뷰(result_service.build_view)에서 두 팀 합계, 점유 흐름, 선수별 핵심 기록,
데이터 품질 정보를 뽑는다. context["basis"]가 저장된 요약의 basis와 다르면 기록이 바뀐 것이다.
"""

from __future__ import annotations

import hashlib
import json
from typing import Dict, List

from app.schemas import AIMatchSummary
from app.services.ai_report_service import EXPECTED_PLAYERS, LOW_BALL_PCT, _clock, _is_gk, _name, _r, create_structured

CONTEXT_VERSION = 1
TOP_PLAYERS = 8  # 팀마다 넘길 선수 수 (볼 관여 순)
MIN_MINUTES = 3.0

TEAM_KEYS = ("possession_pct", "passes_attempted", "passes_completed", "pass_accuracy", "forward_passes", "key_passes",
             "shots", "shots_on_target", "xg", "interceptions", "recoveries", "dispossessed", "touches",
             "set_pieces", "corners", "free_kicks", "throw_ins")
PLAYER_KEYS = ("touches", "passes_attempted", "passes_completed", "pass_accuracy", "forward_passes", "key_passes",
               "shots", "shots_on_target", "xg", "interceptions", "recoveries", "dispossessed")


def _involvement(st: Dict) -> float:
    return ((st.get("touches") or 0) + (st.get("passes_completed") or 0) + 3 * (st.get("key_passes") or 0)
            + 3 * (st.get("shots") or 0) + 2 * (st.get("interceptions") or 0) + 2 * (st.get("recoveries") or 0))


def _basis(ctx: Dict) -> str:
    material = {k: ctx.get(k) for k in ("teams", "players", "possession_flow", "data_quality")}
    material["v"] = CONTEXT_VERSION
    raw = json.dumps(material, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(raw.encode()).hexdigest()


def build_match_context(view: Dict) -> Dict:
    players: List[Dict] = view.get("players") or []
    meta = view.get("meta") or {}
    match = view.get("match") or {}
    ts = view.get("team_stats") or {}
    field_type = (meta.get("field") or {}).get("type") or match.get("field_type") or "soccer"

    teams = {}
    for team in ("home", "away"):
        s = ts.get(team) or {}
        teams[team] = {"name": match.get(f"{team}_team_name"), **{k: _r(s.get(k)) for k in TEAM_KEYS}}

    picked: List[Dict] = []
    for team in ("home", "away"):
        pool = [p for p in players if p["team"] == team and not p.get("excluded") and not p.get("minor")
                and float((p.get("stats") or {}).get("minutes_tracked") or 0) >= MIN_MINUTES]
        pool.sort(key=lambda p: -_involvement(p.get("stats") or {}))
        for p in pool[:TOP_PLAYERS]:
            st = p.get("stats") or {}
            picked.append({
                "track_id": p["track_id"], "name": _name(p), "team": team, "is_goalkeeper": _is_gk(p),
                "minutes_tracked": _r(float(st.get("minutes_tracked") or 0), 1),
                **{k: _r(st.get(k)) for k in PLAYER_KEYS},
            })

    flow = [{"from": _clock(b.get("start_s")), "to": _clock(b.get("end_s")), "home_pct": b.get("home_pct")}
            for b in (view.get("possession_timeline") or [])]

    ball_pct = meta.get("ball_detected_pct")
    expected = EXPECTED_PLAYERS.get(field_type, 11)
    flags = []
    if ball_pct is not None and ball_pct < LOW_BALL_PCT:
        flags.append(f"공 검출률이 {ball_pct:.0f}%로 낮아 볼 기록이 실제보다 적게 잡혔을 수 있습니다.")
    for team in ("home", "away"):
        n = sum(1 for p in players if p["team"] == team and not p.get("excluded") and not p.get("minor"))
        if n > expected * 1.5:
            flags.append(f"{teams[team]['name']} 선수 트랙이 {n}개로 예상 인원({expected}명)보다 많아 "
                         "한 선수의 기록이 여러 트랙으로 나뉘었을 수 있습니다.")
    if meta.get("camera_moving"):
        flags.append("카메라가 움직이는 영상이라 위치·슈팅 판정이 부정확할 수 있습니다.")
    if not meta.get("calibrated") and meta.get("source") != "sample":
        flags.append("경기장 지정(보정)이 없어 공격 방향·슈팅 판정이 부정확할 수 있습니다.")
    if meta.get("source") == "sample" or meta.get("sample"):
        flags.append("샘플(가상 경기) 데이터입니다.")

    ctx = {
        "match": {"title": match.get("title"), "date": match.get("date"), "field_type": field_type,
                  "analyzed_minutes": round(float(meta.get("duration_s") or 0) / 60, 1)},
        "teams": teams,
        "players": picked,
        "possession_flow": flow,
        "data_quality": {"ball_detected_pct": ball_pct, "camera_moving": bool(meta.get("camera_moving")),
                         "calibrated": bool(meta.get("calibrated")), "flags": flags},
    }
    ctx["basis"] = _basis(ctx)
    return ctx


SYSTEM_PROMPT = """당신은 아마추어(조기축구·동호회) 경기를 분석해 온 축구 분석가입니다.
경기 영상을 자동 분석해 얻은 두 팀의 기록을 받아, 경기 직후 팀원들이 단톡방에서 읽을 짧은 경기 요약을 한국어로 씁니다.

근거
- 입력에 있는 숫자만 근거로 씁니다. 입력에 없는 골·스코어·장면·전술·선수 성향을 지어내지 않습니다. 득점 기록은 입력에 없으므로 승패를 말하지 않습니다.
- 수치는 입력 값을 그대로 인용합니다. 두 팀을 비교할 때는 같은 항목끼리 비교합니다.
- 자동 분석이라 오차가 있습니다. "기록상", "이 영상 기준으로"처럼 말하고 단정하지 않습니다.
- data_quality.flags에 적힌 문제는 data_caveats에 짧게 옮깁니다.

출력
- headline: 경기 흐름을 한 문장으로. 예: "점유는 월넛이 55%로 앞섰지만 슈팅은 바모스가 더 많이 만들었습니다."
- key_points: 경기를 가른 기록 2~4개. 각 항목에 근거 숫자를 넣습니다.
- mom: 경기 최우수 선수(MOM) 후보 1~3명. players 안의 track_id만 쓰고, 추천 순서대로 적습니다. reason에는 근거 기록을 한 문장으로 적습니다 (예: "키패스 3개, 패스 성공률 86%"). 골키퍼는 골키퍼 기록으로만 평가합니다.
- data_caveats: 읽을 때 주의할 점. 없으면 빈 배열.
- 존댓말로 담백하게 쓰고 과장·감탄사·느낌표·이모지를 쓰지 않습니다."""

SUMMARY_SCHEMA = {
    "type": "object",
    "properties": {
        "headline": {"type": "string"},
        "key_points": {"type": "array", "items": {"type": "string"}},
        "mom": {"type": "array", "items": {
            "type": "object",
            "properties": {"track_id": {"type": "string"}, "reason": {"type": "string"}},
            "required": ["track_id", "reason"], "additionalProperties": False}},
        "data_caveats": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["headline", "key_points", "mom", "data_caveats"],
    "additionalProperties": False,
}


def generate_match_summary(context: Dict) -> Dict:
    """Claude로 경기 요약을 만든다. MOM 후보는 넘긴 선수 안에서만 남긴다. 실패하면 AIReportError."""
    body = {k: v for k, v in context.items() if k != "basis"}
    user = "다음은 이번 경기의 자동 분석 기록입니다. 이 기록만 근거로 요약해 주세요.\n\n" + json.dumps(body, ensure_ascii=False, indent=1)
    out = create_structured(SYSTEM_PROMPT, user, SUMMARY_SCHEMA, AIMatchSummary)
    allowed = {p["track_id"] for p in context.get("players") or []}
    seen = set()
    mom = []
    for pick in out["report"]["mom"]:
        if pick["track_id"] in allowed and pick["track_id"] not in seen:
            seen.add(pick["track_id"])
            mom.append(pick)
    out["report"]["mom"] = mom[:3]
    return out
