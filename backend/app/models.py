from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from app.database import Base


class Match(Base):
    __tablename__ = "matches"

    id                = Column(Integer, primary_key=True, index=True)
    title             = Column(String(255), nullable=False)
    date              = Column(String(20), nullable=True)
    field_type        = Column(String(20), default="soccer")   # soccer | futsal
    home_team_name    = Column(String(100), default="홈팀")
    away_team_name    = Column(String(100), default="원정팀")
    home_team_color   = Column(String(20), default="#ef4444")
    away_team_color   = Column(String(20), default="#3b82f6")
    video_filename    = Column(String(512), nullable=True)
    status            = Column(String(20), default="created")   # created|uploaded|analyzing|done|failed
    created_at        = Column(DateTime, default=datetime.utcnow)

    players  = relationship("PlayerTrackSummary", back_populates="match", cascade="all, delete-orphan")
    frames   = relationship("FrameTracking",       back_populates="match", cascade="all, delete-orphan")


class PlayerTrackSummary(Base):
    __tablename__ = "player_track_summaries"

    id                     = Column(Integer, primary_key=True, index=True)
    match_id               = Column(Integer, ForeignKey("matches.id"), nullable=False, index=True)
    track_id               = Column(String(50), nullable=False)    # "track_1", "track_2", ...
    team_side              = Column(String(10), nullable=False)     # "home" | "away"
    total_distance_m       = Column(Float, default=0.0)
    avg_position_x         = Column(Float, default=0.5)
    avg_position_y         = Column(Float, default=0.5)
    active_area_score      = Column(Float, default=0.0)
    first_half_distance_m  = Column(Float, default=0.0)
    second_half_distance_m = Column(Float, default=0.0)
    comment                = Column(Text, default="")
    style_badge            = Column(String(50), default="")

    match = relationship("Match", back_populates="players")


class FrameTracking(Base):
    __tablename__ = "frame_trackings"

    id           = Column(Integer, primary_key=True, index=True)
    match_id     = Column(Integer, ForeignKey("matches.id"), nullable=False, index=True)
    frame_index  = Column(Integer, nullable=False)
    timestamp_ms = Column(Integer, nullable=False)
    track_id     = Column(String(50), nullable=False, index=True)
    team_side    = Column(String(10), nullable=False)
    x            = Column(Float, nullable=False)   # 정규화 0-1
    y            = Column(Float, nullable=False)
    bbox_x       = Column(Float, default=0.0)
    bbox_y       = Column(Float, default=0.0)
    bbox_w       = Column(Float, default=0.0)
    bbox_h       = Column(Float, default=0.0)

    match = relationship("Match", back_populates="frames")
