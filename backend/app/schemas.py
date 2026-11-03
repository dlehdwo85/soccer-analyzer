from __future__ import annotations

import re
from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


def _hex(v: Optional[str]) -> Optional[str]:
    if v in (None, ""):
        return None
    if not HEX.match(v):
        raise ValueError("색상은 #RRGGBB 형식이어야 합니다")
    return v.lower()


class MatchCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    date: Optional[str] = None
    field_type: Literal["soccer", "futsal"] = "soccer"
    home_team_name: str = "홈팀"
    away_team_name: str = "원정팀"
    home_team_color: str = "#ef4444"
    away_team_color: str = "#3b82f6"
    referee_color: Optional[str] = "#facc15"
    home_gk_color: Optional[str] = None
    away_gk_color: Optional[str] = None
    home_attacks: Literal["auto", "right", "left"] = "auto"
    halftime_s: Optional[float] = Field(default=None, ge=0)
    home_team_id: Optional[int] = None
    away_team_id: Optional[int] = None

    @field_validator("home_team_color", "away_team_color", "referee_color", "home_gk_color", "away_gk_color")
    @classmethod
    def check_colors(cls, v):
        return _hex(v)


class MatchUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=255)
    date: Optional[str] = None
    field_type: Optional[Literal["soccer", "futsal"]] = None
    home_team_name: Optional[str] = None
    away_team_name: Optional[str] = None
    home_team_color: Optional[str] = None
    away_team_color: Optional[str] = None
    referee_color: Optional[str] = None
    home_gk_color: Optional[str] = None
    away_gk_color: Optional[str] = None
    home_attacks: Optional[Literal["auto", "right", "left"]] = None
    halftime_s: Optional[float] = Field(default=None, ge=0)
    home_team_id: Optional[int] = None
    away_team_id: Optional[int] = None

    @field_validator("home_team_color", "away_team_color", "referee_color", "home_gk_color", "away_gk_color")
    @classmethod
    def check_colors(cls, v):
        return _hex(v)


class MatchOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    title: str
    date: Optional[str]
    field_type: str
    home_team_name: str
    away_team_name: str
    home_team_color: str
    away_team_color: str
    referee_color: Optional[str]
    home_gk_color: Optional[str] = None
    away_gk_color: Optional[str] = None
    home_attacks: Optional[str] = "auto"
    halftime_s: Optional[float] = None
    video_filename: Optional[str]
    video_url: Optional[str] = None
    web_video_url: Optional[str] = None
    status: str
    data_source: Optional[str] = "sample"
    analysis_progress: Optional[float] = 0
    analysis_message: Optional[str] = ""
    analysis_error: Optional[str] = None
    analysis_version: Optional[int] = 0
    calibrated: bool = False
    created_at: datetime
    home_team_id: Optional[int] = None
    away_team_id: Optional[int] = None


class StatusOut(BaseModel):
    status: str
    progress: float
    message: str
    error: Optional[str]
    has_result: bool


class AnalyzeRequest(BaseModel):
    mode: Literal["video", "sample"] = "video"
    use_sample: bool = False  # 이전 클라이언트 호환
    start_seconds: float = Field(default=0, ge=0)
    max_seconds: Optional[float] = Field(default=None, gt=0)
    # standard: 표준 / max: 고정밀(GPU 서버 필요 — 초당 15장면, 대형 모델, 공 4분할 검출)
    quality: Literal["standard", "max"] = "standard"


class CalibrationIn(BaseModel):
    preset: Literal["full", "left_half", "right_half", "custom"]
    image_points: List[List[float]] = Field(min_length=4, max_length=4)
    pitch_points: Optional[List[List[float]]] = None  # custom일 때
    length: Optional[float] = Field(default=None, gt=10, le=130)
    width: Optional[float] = Field(default=None, gt=5, le=100)

    @field_validator("image_points")
    @classmethod
    def _norm(cls, pts):
        for p in pts:
            if len(p) != 2 or not all(-0.5 <= v <= 1.5 for v in p):
                raise ValueError("image_points는 화면 대비 0~1 비율 좌표 4개여야 합니다")
        return pts


class PlayerUpdate(BaseModel):
    display_name: Optional[str] = Field(default=None, max_length=100)
    jersey_number: Optional[int] = Field(default=None, ge=0, le=999)
    team: Optional[Literal["home", "away"]] = None
    excluded: Optional[bool] = None


class MergeRequest(BaseModel):
    target: str
    sources: List[str] = Field(min_length=1)


class VideoUrlBody(BaseModel):
    video_url: str
    filename: str


class EventUpdate(BaseModel):
    """이벤트 검수. result — 패스: completed|intercepted|out, 슈팅: on_target|off_target|blocked."""
    player: Optional[str] = None
    target: Optional[str] = None
    result: Optional[str] = None
    t: Optional[float] = Field(default=None, ge=0)
    deleted: Optional[bool] = None


class EventCreate(BaseModel):
    kind: Literal["pass", "shot", "recovery"]
    t: float = Field(ge=0)
    player: str
    target: Optional[str] = None
    result: Optional[str] = None


# ── AI 선수 분석 ────────────────────────────────────────────────────────────

class AIPlayerReport(BaseModel):
    """Claude가 돌려준 선수 분석 (구조화 출력 스키마와 같은 모양)."""
    summary: str
    rating: Optional[int] = None  # 1~10, 데이터가 부족하면 None(판단 보류)
    strengths: List[str] = Field(default_factory=list)
    improvements: List[str] = Field(default_factory=list)
    next_match_tips: List[str] = Field(default_factory=list)
    data_caveats: List[str] = Field(default_factory=list)

    @field_validator("summary")
    @classmethod
    def _summary(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("summary가 비어 있습니다")
        return v

    @field_validator("rating", mode="before")
    @classmethod
    def _rating(cls, v):
        if v is None or isinstance(v, bool):
            return None
        try:
            n = int(v)
        except (TypeError, ValueError):
            return None
        return n if 1 <= n <= 10 else None

    @field_validator("strengths", "improvements", "next_match_tips", "data_caveats")
    @classmethod
    def _items(cls, v: List[str]) -> List[str]:
        return [s.strip() for s in v if s and s.strip()]


class AIReportUsage(BaseModel):
    input_tokens: int = 0
    output_tokens: int = 0


class AIReportOut(BaseModel):
    track_id: str
    report: AIPlayerReport
    model: str
    usage: AIReportUsage
    generated_at: datetime
    stale: bool = False  # 분석 후 기록(이벤트·병합 등)이 바뀌었으면 True


# ── AI 경기 요약 ────────────────────────────────────────────────────────────

class AIMomPick(BaseModel):
    track_id: str
    reason: str


class AIMatchSummary(BaseModel):
    """Claude가 돌려준 경기 요약 — '무엇이 승부를 갈랐나'와 경기 최우수 선수(MOM) 후보."""
    headline: str
    key_points: List[str] = Field(default_factory=list)
    mom: List[AIMomPick] = Field(default_factory=list)  # 앞에서부터 추천 순
    data_caveats: List[str] = Field(default_factory=list)

    @field_validator("headline")
    @classmethod
    def _headline(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("headline이 비어 있습니다")
        return v

    @field_validator("key_points", "data_caveats")
    @classmethod
    def _items(cls, v: List[str]) -> List[str]:
        return [s.strip() for s in v if s and s.strip()]


class AIMatchSummaryOut(BaseModel):
    summary: AIMatchSummary
    model: str
    usage: AIReportUsage
    generated_at: datetime
    stale: bool = False


# ── 팀·명단 ─────────────────────────────────────────────────────────────────

class RosterEntry(BaseModel):
    number: Optional[int] = Field(default=None, ge=0, le=999)
    name: str = Field(min_length=1, max_length=100)

    @field_validator("name")
    @classmethod
    def strip_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("이름을 입력하세요")
        return v


class TeamIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    color: str = "#56b4d3"
    roster: List[RosterEntry] = Field(default_factory=list, max_length=80)

    @field_validator("color")
    @classmethod
    def check_color(cls, v):
        return _hex(v)


class TeamOut(BaseModel):
    id: int
    name: str
    color: str
    roster: List[RosterEntry]
    match_count: int = 0
    created_at: datetime
    member_count: int = 0
    my_role: Optional[str] = None      # 로그인한 사람의 권한 (owner | manager | member)
    can_edit: bool = True              # 명단·팀 정보를 고칠 수 있는가
