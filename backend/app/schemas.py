from __future__ import annotations
from datetime import datetime
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, ConfigDict


class MatchCreate(BaseModel):
    title: str
    date: Optional[str] = None
    field_type: str = "soccer"
    home_team_name: str = "홈팀"
    away_team_name: str = "원정팀"
    home_team_color: str = "#ef4444"
    away_team_color: str = "#3b82f6"
    referee_color: str = "#facc15"


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
    referee_color: str
    video_filename: Optional[str]
    status: str
    data_source: str = "sample"
    created_at: datetime


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
    fatigue_index: float
    press_count: int
    zone_left_pct: float
    zone_center_pct: float
    zone_right_pct: float
    role_type: str
    sprint_count: int


class FramePointOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    frame_index: int
    timestamp_ms: int
    x: float
    y: float


class PlayerDetailOut(PlayerOut):
    frames: List[FramePointOut] = []


class MatchAnalyticsOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    home_formation: str
    away_formation: str
    home_zone_map: str
    away_zone_map: str
    home_centroid_timeline: str
    away_centroid_timeline: str
    home_fatigue_timeline: str
    away_fatigue_timeline: str
    home_total_distance_m: float
    away_total_distance_m: float
    home_avg_press_dist: float
    away_avg_press_dist: float
    match_summary_text: str


class MatchSummaryOut(BaseModel):
    match: MatchOut
    players: List[PlayerOut]
    home_avg_x: float
    home_avg_y: float
    away_avg_x: float
    away_avg_y: float
    total_distance_km: float
    analytics: Optional[MatchAnalyticsOut] = None


class AnalyzeRequest(BaseModel):
    use_sample: bool = False


# ── GPS 관련 스키마 ────────────────────────────────────────────────────────

class GpsPlayerPreview(BaseModel):
    player_id:     str
    player_name:   str
    jersey_number: int
    team:          str
    point_count:   int
    time_range_sec: float = 0.0


class GpsPreviewOut(BaseModel):
    total_points:  int
    total_players: int
    duration_sec:  float
    teams:         List[str]
    lat_range:     List[float] = []
    lng_range:     List[float] = []
    players:       List[GpsPlayerPreview]


class GpsUploadResult(BaseModel):
    message:       str
    total_points:  int
    total_players: int
    duration_sec:  float
    preview:       GpsPreviewOut


# ── 선수 프로필 스키마 ─────────────────────────────────────────────────────

class PlayerProfileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id:              int
    jersey_number:   int
    player_name:     str
    team_name:       str
    total_matches:   int
    total_distance_m: float
    total_sprints:   int
    avg_fatigue:     float


class PlayerMatchHistoryItem(BaseModel):
    match_id:        int
    match_title:     str
    match_date:      Optional[str]
    total_distance_m: float
    sprint_count:    int
    fatigue_index:   float
    data_source:     str
