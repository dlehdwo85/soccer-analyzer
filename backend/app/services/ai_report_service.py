"""AI 선수 분석 — 기록된 수치·이벤트만 Claude에 넘겨 선수별 경기 분석 글을 만든다.

build_player_context()는 결과 뷰(result_service.build_view)에서 한 선수의 기록, 팀 평균, 본인 이벤트,
평균 위치, 데이터 품질 정보를 뽑는다. generate_player_report()가 그 내용을 Claude에 보내
정해진 JSON 형식(요약·평점·강점·개선점·다음 경기 제안·데이터 주의사항)으로 받는다.

context["basis"]는 분석에 쓴 기록의 해시다. 저장된 분석의 basis와 지금 기록의 basis가 다르면
(이벤트 검수·트랙 병합 등으로 기록이 바뀌면) 화면에서 다시 분석하라고 알려 준다.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
from typing import Dict, List, Optional

import anthropic
from pydantic import ValidationError

from app.schemas import AIPlayerReport

logger = logging.getLogger(__name__)

MODEL = "claude-opus-5-5"
MAX_TOKENS = 8000
EFFORT = "medium"
FALLBACK_BETA = "server-side-fallback-2026-07-01"
# Vercel 함수 한도(300초) 안에서 끝나도록: 요청 하나 최대 140초, 재시도 1번
REQUEST_TIMEOUT_S = 140.0
MAX_RETRIES = 1
CONTEXT_VERSION = 1
MAX_EVENTS = 200

NO_KEY_MESSAGE = "AI 분석을 쓰려면 서버에 ANTHROPIC_API_KEY를 설정해야 합니다"

# 데이터 품질 기준 (시스템 프롬프트와 같은 값)
LOW_BALL_PCT = 85.0
SHORT_MINUTES = 5.0

COUNT_KEYS = ("touches", "possession_s", "passes_attempted", "passes_completed", "passes_failed", "passes_received",
              "forward_passes", "key_passes", "shots", "shots_on_target", "shots_blocked", "xg",
              "interceptions", "recoveries", "dispossessed")
SET_PIECE_KEYS = ("set_pieces", "corners", "free_kicks", "throw_ins", "goal_kicks", "kick_offs")
EXPECTED_PLAYERS = {"soccer": 11, "futsal": 5}


class AIReportError(Exception):
    """AI 분석 실패. status_code는 라우터가 그대로 HTTP 상태로 쓴다."""
    status_code = 502

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class AIReportNotConfigured(AIReportError):
    status_code = 503


class AIReportRefused(AIReportError):
    status_code = 502


# ── Claude 클라이언트 ────────────────────────────────────────────────────────

def is_configured() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY", "").strip())


def get_client() -> anthropic.Anthropic:
    """테스트에서 monkeypatch로 바꿔 끼우는 클라이언트 생성 함수. 키는 ANTHROPIC_API_KEY 환경변수에서 읽는다."""
    return anthropic.Anthropic(timeout=REQUEST_TIMEOUT_S, max_retries=MAX_RETRIES)


# ── 맥락 만들기 ──────────────────────────────────────────────────────────────

def _clock(sec: Optional[float]) -> Optional[str]:
    """초 → m:ss (1시간 이상이면 h:mm:ss) — 화면의 이벤트 시각 표기와 같다."""
    if sec is None:
        return None
    s = max(0, int(sec))
    h, m, r = s // 3600, (s % 3600) // 60, s % 60
    return f"{h}:{m:02d}:{r:02d}" if h else f"{m}:{r:02d}"


def _name(p: Optional[Dict]) -> Optional[str]:
    if not p:
        return None
    if p.get("display_name"):
        return f"{p['jersey_number']}. {p['display_name']}" if p.get("jersey_number") is not None else p["display_name"]
    if p.get("jersey_number") is not None:
        return f"{p['jersey_number']}번"
    return f"트랙 {p['track_id']}"


def _is_gk(p: Dict) -> bool:
    return (p.get("label") or "").endswith("_gk")


def _r(v, nd: int = 2):
    return round(v, nd) if isinstance(v, float) else v


def _per10(st: Dict, minutes: float) -> Optional[Dict]:
    if not minutes or minutes < 1:
        return None
    return {k: round((st.get(k) or 0) / minutes * 10, 2) for k in COUNT_KEYS}


def _event_line(e: Dict, me: str, by_tid: Dict[str, Dict]) -> Optional[Dict]:
    kind, detail = e.get("kind"), e.get("detail") or {}
    actor = e.get("player") == me
    out: Dict = {"time": _clock(e.get("t")), "kind": kind}
    other = by_tid.get(e.get("target") if actor else e.get("player"))
    if actor:
        out["role"] = "본인"
        if kind == "pass":
            out["success"] = bool(e.get("success"))
            out["outcome"] = detail.get("reason") or ("completed" if e.get("success") else "lost")
            if detail.get("forward") and e.get("success"):
                out["forward"] = True
            if detail.get("length_m") is not None:
                out["length_m"] = _r(float(detail["length_m"]), 1)
        elif kind == "shot":
            out["success"] = bool(e.get("success"))
            out["outcome"] = detail.get("outcome") or "off_target"
            if detail.get("xg") is not None:
                out["xg"] = _r(float(detail["xg"]))
        elif kind == "recovery":
            out["success"] = True
        elif kind == "set_piece":
            out["outcome"] = detail.get("type") or "restart"
    elif e.get("target") == me:
        if kind == "pass":
            out["role"] = "받음" if e.get("success") else "가로챔"
        elif kind == "recovery":
            out["role"] = "뺏김"
        elif kind == "shot":
            out["role"] = "슈팅 막음"
        else:
            return None
    else:
        return None
    if other is not None:
        out["target" if actor else "from"] = _name(other)
    if e.get("manual") or e.get("edited"):
        out["checked_by_user"] = True
    return out


def _attack_depth(avg_x: Optional[float], team: str, meta: Dict, first_seen: Optional[float],
                  last_seen: Optional[float]) -> Optional[float]:
    """평균 위치를 '자기 골라인 0 → 상대 골라인 1'로. 전·후반에 걸쳐 방향이 바뀌면 판단하지 않는다."""
    att = meta.get("attack") or {}
    if avg_x is None or not att:
        return None
    ht = meta.get("halftime_rel_s")
    if ht is None:
        half = "first"
    elif last_seen is not None and last_seen < ht:
        half = "first"
    elif first_seen is not None and first_seen >= ht:
        half = "second"
    else:
        return None
    d = (att.get(half) or {}).get(team)
    if d not in (1, -1):
        return None
    return round(avg_x if d > 0 else 1 - avg_x, 3)


def _basis(ctx: Dict) -> str:
    """기록(수치·이벤트) 해시. '검수함' 표시만 바뀐 것은 기록 변경으로 보지 않는다."""
    material = {k: ctx.get(k) for k in ("stats", "per_10min", "team_average", "average_position", "data_quality")}
    material["events"] = [{k: v for k, v in e.items() if k != "checked_by_user"} for e in ctx.get("events") or []]
    material["v"] = CONTEXT_VERSION
    raw = json.dumps(material, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(raw.encode()).hexdigest()


def context_basis(ctx: Dict) -> str:
    return ctx.get("basis") or _basis(ctx)


def build_player_context(view: Dict, track_id: str) -> Dict:
    """결과 뷰에서 한 선수(병합 대표 트랙)의 분석용 맥락을 만든다. 없는 선수면 KeyError."""
    players: List[Dict] = view.get("players") or []
    by_tid = {p["track_id"]: p for p in players}
    if track_id not in by_tid:
        raise KeyError(track_id)
    p = by_tid[track_id]
    st = p.get("stats") or {}
    meta = view.get("meta") or {}
    match = view.get("match") or {}
    team = p["team"]
    opp = "away" if team == "home" else "home"
    gk = _is_gk(p)
    minutes = float(st.get("minutes_tracked") or 0)
    duration_min = round(float(meta.get("duration_s") or 0) / 60, 1)
    field_type = (meta.get("field") or {}).get("type") or match.get("field_type") or "soccer"

    stats = {k: _r(st.get(k) or 0) for k in COUNT_KEYS}
    stats.update({"pass_accuracy_pct": st.get("pass_accuracy"), "avg_pass_length_m": st.get("avg_pass_length_m"),
                  "minutes_tracked": minutes})
    for k in SET_PIECE_KEYS:
        if st.get(k):
            stats[k] = st[k]

    # 팀 평균 — 같은 팀, 제외·짧은 조각 트랙 제외, 필드 선수면 골키퍼도 뺀다
    peers = [q for q in players if q["team"] == team and not q.get("excluded") and not q.get("minor")
             and (gk or not _is_gk(q)) and (q.get("stats") or {}).get("minutes_tracked")]
    n = len(peers)
    team_avg: Dict = {"players_counted": n}
    if n:
        tot = {k: sum((q["stats"].get(k) or 0) for q in peers) for k in COUNT_KEYS}
        tot_min = sum(float(q["stats"].get("minutes_tracked") or 0) for q in peers)
        team_avg["minutes_tracked"] = round(tot_min / n, 1)
        team_avg["per_player"] = {k: round(tot[k] / n, 2) for k in COUNT_KEYS}
        team_avg["per_10min"] = _per10(tot, tot_min)
        team_avg["pass_accuracy_pct"] = (round(tot["passes_completed"] / tot["passes_attempted"] * 100, 1)
                                         if tot["passes_attempted"] else None)

    # 본인 이벤트 (시간순)
    evs = []
    for e in sorted(view.get("events") or [], key=lambda ev: ev.get("t") or 0):
        line = _event_line(e, track_id, by_tid)
        if line:
            evs.append(line)
    truncated = len(evs) > MAX_EVENTS
    evs = evs[:MAX_EVENTS]

    avg_x, avg_y = st.get("avg_x"), st.get("avg_y")
    position = {
        "avg_x": avg_x, "avg_y": avg_y,
        "depth_toward_opponent_goal": _attack_depth(avg_x, team, meta, st.get("first_seen_s"), st.get("last_seen_s")),
        "distance_from_center_line": round(abs(avg_y - 0.5) * 2, 3) if avg_y is not None else None,
    }

    # 데이터 품질
    ball_pct = meta.get("ball_detected_pct")
    sample = meta.get("source") == "sample" or bool(meta.get("sample"))
    calibrated = bool(meta.get("calibrated"))  # 분석 당시 보정 여부 (나중에 보정해도 이 기록엔 반영 안 됨)
    camera_moving = bool(meta.get("camera_moving"))
    team_tracks = sum(1 for q in players if q["team"] == team and not q.get("excluded") and not q.get("minor"))
    expected = EXPECTED_PLAYERS.get(field_type, 11)
    pieces = 1 + len(p.get("merged_from") or [])
    share = round(minutes / duration_min * 100, 1) if duration_min else None
    ball_events = sum(stats[k] for k in ("touches", "passes_attempted", "shots", "recoveries", "interceptions"))
    flags = []
    if sample:
        flags.append("샘플(가상 경기) 데이터입니다. 실제 경기 기록이 아닙니다.")
    if ball_pct is not None and ball_pct < LOW_BALL_PCT:
        flags.append(f"공 검출률이 {ball_pct:.0f}%로 낮아 볼 기록이 실제보다 적게 잡혔을 수 있습니다.")
    if minutes < SHORT_MINUTES:
        flags.append(f"기록된 출전 시간이 {minutes:.1f}분으로 짧아 표본이 작습니다.")
    if team_tracks > expected * 1.5:
        flags.append(f"이 팀의 선수 트랙이 {team_tracks}개로 예상 인원({expected}명)보다 많습니다. "
                     "한 선수의 기록이 여러 트랙으로 나뉘어 일부가 빠졌을 수 있습니다.")
    if share is not None and duration_min >= 10 and share < 50 and minutes >= SHORT_MINUTES:
        flags.append(f"분석 구간 {duration_min:.0f}분 중 {minutes:.0f}분만 추적되었습니다.")
    if camera_moving:
        flags.append("카메라가 움직이는 영상이라 위치·슈팅 판정이 부정확할 수 있습니다.")
    if not calibrated and not sample:
        flags.append("경기장 지정(보정)이 없어 위치·방향 판정이 부정확할 수 있습니다.")
    if ball_events == 0:
        flags.append("기록된 볼 이벤트가 없습니다.")
    if truncated:
        flags.append(f"이벤트가 많아 앞쪽 {MAX_EVENTS}개만 넘겼습니다.")

    team_name = match.get("home_team_name") if team == "home" else match.get("away_team_name")
    opp_name = match.get("away_team_name") if team == "home" else match.get("home_team_name")
    ts = view.get("team_stats") or {}

    def _team_line(t: str) -> Dict:
        s = ts.get(t) or {}
        return {k: s.get(k) for k in ("possession_pct", "passes_attempted", "pass_accuracy", "shots",
                                      "shots_on_target", "xg", "interceptions", "recoveries")}

    ctx = {
        "match": {
            "title": match.get("title"), "date": match.get("date"), "field_type": field_type,
            "analyzed_minutes": duration_min, "team_name": team_name, "opponent_name": opp_name,
            "team_summary": {"mine": _team_line(team), "opponent": _team_line(opp)},
        },
        "player": {
            "track_id": track_id, "name": _name(p), "team": team, "is_goalkeeper": gk,
            "first_seen": _clock(st.get("first_seen_s")), "last_seen": _clock(st.get("last_seen_s")),
        },
        "stats": stats,
        "per_10min": _per10(stats, minutes),
        "team_average": team_avg,
        "events": evs,
        "average_position": position,
        "data_quality": {
            "source": "sample" if sample else (meta.get("source") or "video"),
            "ball_detected_pct": ball_pct,
            "camera_moving": camera_moving,
            "calibrated": calibrated,
            "warnings": list(meta.get("warnings") or []),
            "minutes_tracked": minutes,
            "tracked_share_pct": share,
            "track_pieces": pieces,
            "team_tracks": team_tracks,
            "expected_players_per_team": expected,
            "flags": flags,
        },
    }
    ctx["basis"] = _basis(ctx)
    return ctx


# ── Claude 호출 ─────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """당신은 아마추어(조기축구·동호회) 팀을 오래 지도해 온 축구 코치이자 경기 분석가입니다.
경기 영상을 자동 분석해 얻은 한 선수의 기록을 받아, 그 선수 본인이 읽을 짧은 경기 분석을 한국어로 씁니다.

근거
- 입력에 있는 숫자와 이벤트만 근거로 씁니다. 입력에 없는 골·어시스트·장면·움직임·체력·태도·포지션을 지어내지 않습니다.
- 수치는 입력 값을 그대로 인용합니다. 입력 값으로 바로 확인할 수 없는 비율·순위는 만들지 않습니다.
- 예를 들 때는 events의 time 값을 그대로 적습니다 (예: "12:34 전진 패스 성공"). 없는 시각을 만들지 않습니다.
- 강점과 개선점은 team_average와 비교해 고릅니다. 출전 시간이 다르면 per_10min끼리 비교합니다.
- 자동 분석은 공과 선수 위치로 패스·슈팅·탈취를 추정한 것이라 오차가 있습니다. "기록상", "이 영상 기준으로"처럼 말하고 단정하지 않습니다.
- 골키퍼(is_goalkeeper)는 슈팅·키패스로 평가하지 않습니다.

입력 항목
- events[].role: 본인 = 이 선수가 한 플레이, 받음 = 이 선수가 받은 패스, 가로챔 = 상대 패스를 이 선수가 끊음, 뺏김 = 이 선수가 공을 빼앗김, 슈팅 막음 = 상대 슈팅을 막음.
- events[].outcome: 패스 completed(성공)·intercepted(상대에게 차단)·out(밖으로)·lost(실패), 슈팅 on_target(유효)·off_target(빗나감)·blocked(막힘).
- events[].checked_by_user: 사용자가 직접 확인·수정한 기록입니다.
- average_position: avg_x·avg_y는 경기장 길이·너비 대비 0~1 위치입니다. depth_toward_opponent_goal은 0 = 자기 골라인, 1 = 상대 골라인이고, null이면 공격 방향을 판단할 수 없으니 위치로 역할을 추측하지 않습니다. distance_from_center_line은 0 = 가운데, 1 = 터치라인입니다.
- data_quality.flags: 미리 찾아 둔 데이터 문제입니다.

데이터 품질
- 다음 경우에는 분명히 말하고 data_caveats에 이유를 적습니다: 공 검출률(ball_detected_pct) 85% 미만, 기록된 출전 시간 5분 미만, 트랙이 여러 조각으로 나뉜 경우(team_tracks가 expected_players_per_team보다 크게 많음), 카메라가 움직인 영상, 경기장 보정 없음, 샘플 데이터, flags에 적힌 문제.
- 표본이 너무 작거나 데이터 품질이 낮아 경기력을 판단하기 어려우면 rating을 null로 두고, 요약에서도 판단을 보류한다고 말합니다.

출력
- summary: 2~3문장 요약.
- rating: 1~10 정수. 6은 이 팀 안에서 평균적인 경기입니다. 판단하기 어려우면 null.
- strengths: 기록으로 뒷받침되는 강점 1~3개.
- improvements: 개선할 점 1~3개.
- next_match_tips: 다음 경기에서 해볼 구체적인 행동 1~3개.
- data_caveats: 이 분석을 읽을 때 주의할 점. 없으면 빈 배열.
- 각 항목은 한두 문장으로 짧게 씁니다. 존댓말로 담백하게 쓰고 과장·감탄사·느낌표·이모지를 쓰지 않습니다."""

REPORT_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "rating": {"anyOf": [{"type": "integer", "enum": list(range(1, 11))}, {"type": "null"}]},
        "strengths": {"type": "array", "items": {"type": "string"}},
        "improvements": {"type": "array", "items": {"type": "string"}},
        "next_match_tips": {"type": "array", "items": {"type": "string"}},
        "data_caveats": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["summary", "rating", "strengths", "improvements", "next_match_tips", "data_caveats"],
    "additionalProperties": False,
}


def _user_message(ctx: Dict) -> str:
    body = {k: v for k, v in ctx.items() if k != "basis"}
    return ("다음은 한 선수의 이번 경기 기록입니다. 이 기록만 근거로 분석해 주세요.\n\n"
            + json.dumps(body, ensure_ascii=False, indent=1))


def _response_text(response) -> str:
    """fallback 블록이 있으면 그 뒤(실제로 응답한 모델)의 텍스트만."""
    blocks = list(response.content or [])
    last_fb = max((i for i, b in enumerate(blocks) if getattr(b, "type", None) == "fallback"), default=-1)
    return "".join(b.text for b in blocks[last_fb + 1:] if getattr(b, "type", None) == "text")


def _usage(response) -> Dict:
    u = getattr(response, "usage", None)
    out = {"input_tokens": int(getattr(u, "input_tokens", 0) or 0),
           "output_tokens": int(getattr(u, "output_tokens", 0) or 0)}
    for k in ("cache_read_input_tokens", "cache_creation_input_tokens"):
        v = getattr(u, k, None)
        if v:
            out[k] = int(v)
    return out


def _fallback_used(response) -> bool:
    iterations = getattr(getattr(response, "usage", None), "iterations", None) or []
    return any(getattr(it, "type", None) == "fallback_message" for it in iterations)


def generate_player_report(context: Dict) -> Dict:
    """Claude로 선수 분석을 만든다. {report, model, usage, fallback_used} 반환. 실패하면 AIReportError."""
    return create_structured(SYSTEM_PROMPT, _user_message(context), REPORT_SCHEMA, AIPlayerReport)


def create_structured(system: str, user: str, schema: Dict, model_cls) -> Dict:
    """Claude에 JSON 스키마 형식으로 답을 받아 model_cls로 검증한다. {report, model, usage, fallback_used}.
    선수 분석과 경기 요약이 함께 쓴다. 실패하면 AIReportError."""
    if not is_configured():
        raise AIReportNotConfigured(NO_KEY_MESSAGE)
    client = get_client()
    try:
        response = client.beta.messages.create(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            betas=[FALLBACK_BETA],
            fallbacks="default",
            output_config={"effort": EFFORT, "format": {"type": "json_schema", "schema": schema}},
            system=system,
            messages=[{"role": "user", "content": user}],
        )
    except anthropic.AuthenticationError as e:
        logger.error("AI 분석 인증 실패: %s", e)
        raise AIReportError("서버의 ANTHROPIC_API_KEY가 올바르지 않습니다")
    except anthropic.RateLimitError as e:
        logger.warning("AI 분석 사용 한도 초과: %s", e)
        raise AIReportError("AI 사용 한도를 넘었습니다. 잠시 후 다시 시도해 주세요")
    except anthropic.APIStatusError as e:
        logger.error("AI 분석 API 오류 %s (request_id=%s): %s", e.status_code, getattr(e, "request_id", None), e.message)
        if e.status_code >= 500:
            raise AIReportError("AI 서버가 잠시 응답하지 않습니다. 잠시 후 다시 시도해 주세요")
        raise AIReportError(f"AI 분석 요청이 거절되었습니다 ({e.status_code})")
    except anthropic.APITimeoutError:
        logger.warning("AI 분석 응답 시간 초과")
        raise AIReportError("AI 응답이 너무 오래 걸립니다. 잠시 후 다시 시도해 주세요")
    except anthropic.APIConnectionError as e:
        logger.warning("AI 서버 연결 실패: %s", e)
        raise AIReportError("AI 서버에 연결하지 못했습니다")

    # 거절은 content를 읽기 전에 확인한다 (빈 content 또는 버려야 할 일부만 있을 수 있다)
    if response.stop_reason == "refusal":
        details = getattr(response, "stop_details", None)
        logger.warning("AI 분석 거절 (category=%s)", getattr(details, "category", None))
        raise AIReportRefused("AI가 이 기록의 분석을 거절했습니다. 기록을 확인한 뒤 다시 시도해 주세요")
    if response.stop_reason == "max_tokens":
        raise AIReportError("AI 응답이 길이 제한에 걸려 잘렸습니다. 다시 시도해 주세요")

    text = _response_text(response)
    try:
        report = model_cls.model_validate(json.loads(text))
    except (ValueError, ValidationError) as e:
        logger.error("AI 분석 응답 형식 오류: %s / %r", e, text[:500])
        raise AIReportError("AI 응답 형식이 올바르지 않습니다. 다시 시도해 주세요")

    return {
        "report": report.model_dump(),
        "model": getattr(response, "model", None) or MODEL,
        "usage": _usage(response),
        "fallback_used": _fallback_used(response),
    }
