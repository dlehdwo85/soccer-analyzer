from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from app.database import Base


class Match(Base):
    __tablename__ = "matches"

    id                = Column(Integer, primary_key=True, index=True)
    title             = Column(String(255), nullable=False)
    date              = Column(String(20), nullable=True)
    field_type        = Column(String(20), default="soccer")
    home_team_name    = Column(String(100), default="홈팀")
    away_team_name    = Column(String(100), default="원정팀")
    home_team_color   = Column(String(20), default="#56b4d3")
    away_team_color   = Column(String(20), default="#ef4444")
    referee_color     = Column(String(20), default="#facc15")
    video_filename    = Column(String(512), nullable=True)
    video_url         = Column(String(1024), nullable=True)  # Supabase URL 또는 YouTube URL
    status            = Column(String(20), default="created")
    # 분석 데이터 소스: video | gps | sample
    data_source       = Column(String(20), default="sample")
    created_at        = Column(DateTime, default=datetime.utcnow)

    players         = relationship("PlayerTrackSummary", back_populates="match", cascade="all, delete-orphan")
    frames          = relationship("FrameTracking", back_populates="match", cascade="all, delete-orphan")
    match_analytics = relationship("MatchAnalytics", back_populates="match", uselist=False, cascade="all, delete-orphan")
    gps_tracks      = relationship("GpsTrackPoint", back_populates="match", cascade="all, delete-orphan")


class PlayerTrackSummary(Base):
    __tablename__ = "player_track_summaries"

    id                     = Column(Integer, primary_key=True, index=True)
    match_id               = Column(Integer, ForeignKey("matches.id"), nullable=False, index=True)
    track_id               = Column(String(50), nullable=False)
    team_side              = Column(String(10), nullable=False)
    total_distance_m       = Column(Float, default=0.0)
    avg_position_x         = Column(Float, default=0.5)
    avg_position_y         = Column(Float, default=0.5)
    active_area_score      = Column(Float, default=0.0)
    first_half_distance_m  = Column(Float, default=0.0)
    second_half_distance_m = Column(Float, default=0.0)
    comment                = Column(Text, default="")
    style_badge            = Column(String(50), default="")
    fatigue_index          = Column(Float, default=0.0)
    press_count            = Column(Integer, default=0)
    zone_left_pct          = Column(Float, default=33.0)
    zone_center_pct        = Column(Float, default=34.0)
    zone_right_pct         = Column(Float, default=33.0)
    role_type              = Column(String(30), default="")
    sprint_count           = Column(Integer, default=0)

    match = relationship("Match", back_populates="players")


class FrameTracking(Base):
    __tablename__ = "frame_trackings"

    id           = Column(Integer, primary_key=True, index=True)
    match_id     = Column(Integer, ForeignKey("matches.id"), nullable=False, index=True)
    frame_index  = Column(Integer, nullable=False)
    timestamp_ms = Column(Integer, nullable=False)
    track_id     = Column(String(50), nullable=False, index=True)
    team_side    = Column(String(10), nullable=False)
    x            = Column(Float, nullable=False)
    y            = Column(Float, nullable=False)
    bbox_x       = Column(Float, default=0.0)
    bbox_y       = Column(Float, default=0.0)
    bbox_w       = Column(Float, default=0.0)
    bbox_h       = Column(Float, default=0.0)

    match = relationship("Match", back_populates="frames")


class GpsTrackPoint(Base):
    """GPS 원본 좌표 포인트 저장 (파일 재분석 / 원본 보존용)."""
    __tablename__ = "gps_track_points"

    id             = Column(Integer, primary_key=True, index=True)
    match_id       = Column(Integer, ForeignKey("matches.id"), nullable=False, index=True)
    player_id      = Column(String(50), nullable=False, index=True)
    player_name    = Column(String(100), default="")
    jersey_number  = Column(Integer, default=0)
    team_side      = Column(String(10), default="home")
    timestamp_ms   = Column(Integer, nullable=False)
    lat            = Column(Float, nullable=False)
    lng            = Column(Float, nullable=False)
    speed_mps      = Column(Float, default=0.0)
    norm_x         = Column(Float, default=0.5)   # 정규화 x (0~1)
    norm_y         = Column(Float, default=0.5)   # 정규화 y (0~1)

    match = relationship("Match", back_populates="gps_tracks")


class PlayerProfile(Base):
    """등번호 기반 선수 프로필 — 여러 경기 누적 통계."""
    __tablename__ = "player_profiles"

    id             = Column(Integer, primary_key=True, index=True)
    jersey_number  = Column(Integer, nullable=False, index=True)
    player_name    = Column(String(100), nullable=False)
    team_name      = Column(String(100), default="")
    total_matches  = Column(Integer, default=0)
    total_distance_m = Column(Float, default=0.0)
    total_sprints  = Column(Integer, default=0)
    avg_fatigue    = Column(Float, default=0.0)
    created_at     = Column(DateTime, default=datetime.utcnow)
    updated_at     = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class MatchAnalytics(Base):
    __tablename__ = "match_analytics"

    id                     = Column(Integer, primary_key=True, index=True)
    match_id               = Column(Integer, ForeignKey("matches.id"), nullable=False, unique=True)
    home_formation         = Column(String(20), default="4-4-2")
    away_formation         = Column(String(20), default="4-4-2")
    home_zone_map          = Column(Text, default="{}")
    away_zone_map          = Column(Text, default="{}")
    home_press_timeline    = Column(Text, default="[]")
    away_press_timeline    = Column(Text, default="[]")
    home_centroid_timeline = Column(Text, default="[]")
    away_centroid_timeline = Column(Text, default="[]")
    home_fatigue_timeline  = Column(Text, default="[]")
    away_fatigue_timeline  = Column(Text, default="[]")
    home_total_distance_m  = Column(Float, default=0.0)
    away_total_distance_m  = Column(Float, default=0.0)
    home_avg_press_dist    = Column(Float, default=0.0)
    away_avg_press_dist    = Column(Float, default=0.0)
    match_summary_text     = Column(Text, default="")
    created_at             = Column(DateTime, default=datetime.utcnow)

    match = relationship("Match", back_populates="match_analytics")
