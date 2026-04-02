from __future__ import annotations
from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, ConfigDict


# ── Match ──────────────────────────────────────────────────────────────────
class MatchCreate(BaseModel):
    title: str
    date: Optional[str] = None
    field_type: str = "soccer"
    home_team_name: str = "홈팀"
    away_team_name: str = "원정팀"
    home_team_color: str = "#ef4444"
    away_team_color: str = "#3b82f6"


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
    video_filename: Optional[str]
    status: str
    created_at: datetime


# ── Player ─────────────────────────────────────────────────────────────────
class PlayerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    match_id: int
    track_id: str
    team_side: str
    total_distance_m: float
    avg_position_x: float
    avg_position_y: float
    active_area_score: float
    first_half_distance_m: float
    second_half_distance_m: float
    comment: str
    style_badge: str


# ── FramePoint ────────────────────────────────────────────────────────────
class FramePointOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    frame_index: int
    timestamp_ms: int
    x: float
    y: float


class PlayerDetailOut(PlayerOut):
    frames: List[FramePointOut] = []


# ── Summary ───────────────────────────────────────────────────────────────
class MatchSummaryOut(BaseModel):
    match: MatchOut
    players: List[PlayerOut]
    home_avg_x: float
    home_avg_y: float
    away_avg_x: float
    away_avg_y: float
    total_distance_km: float


# ── Analyze ───────────────────────────────────────────────────────────────
class AnalyzeRequest(BaseModel):
    use_sample: bool = False
