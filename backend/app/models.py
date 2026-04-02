from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Text, JSON
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
    home_team_color   = Column(String(20), default="#ef4444")
    away_team_color   = Column(String(20), default="#3b82f6")
    # 심판 색상 추가
    referee_color     = Column(String(20), default="#facc15")
    video_filename    = Column(String(512), nullable=True)
    status            = Column(String(20), default="created")
    created_at        = Column(DateTime, default=datetime.utcnow)

    players           = relationship("PlayerTrackSummary", back_populates="match", cascade="all, delete-orphan")
    frames            = relationship("FrameTracking",       back_populates="match", cascade="all, delete-orphan")
    # 신규: 경기 전체 분석 요약
    match_analytics   = relationship("MatchAnalytics",      back_populates="match", uselist=False, cascade="all, delete-orphan")


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

    # 신규 지표
    fatigue_index          = Column(Float, default=0.0)   # 피로도 0~100
    press_count            = Column(Integer, default=0)   # 압박 횟수
    zone_left_pct          = Column(Float, default=33.0)  # 좌측 점유 %
    zone_center_pct        = Column(Float, default=34.0)
    zone_right_pct         = Column(Float, default=33.0)
    role_type              = Column(String(30), default="")  # 공격수/수비수/플메이커/윙어
    sprint_count           = Column(Integer, default=0)   # 스프린트 횟수

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


class MatchAnalytics(Base):
    """경기 전체 고급 분석 결과 (신규)"""
    __tablename__ = "match_analytics"

    id              = Column(Integer, primary_key=True, index=True)
    match_id        = Column(Integer, ForeignKey("matches.id"), nullable=False, unique=True)

    # 포메이션
    home_formation  = Column(String(20), default="4-4-2")
    away_formation  = Column(String(20), default="4-4-2")

    # 공간 점유율 (9구역 JSON)
    home_zone_map   = Column(Text, default="{}")   # JSON: {zone: pct}
    away_zone_map   = Column(Text, default="{}")

    # 압박 강도 (시간대별 JSON)
    home_press_timeline = Column(Text, default="[]")
    away_press_timeline = Column(Text, default="[]")

    # 팀 무게중심 이동 (타임라인 JSON)
    home_centroid_timeline = Column(Text, default="[]")
    away_centroid_timeline = Column(Text, default="[]")

    # 피로도 타임라인
    home_fatigue_timeline  = Column(Text, default="[]")
    away_fatigue_timeline  = Column(Text, default="[]")

    # 경기 요약 수치
    home_total_distance_m  = Column(Float, default=0.0)
    away_total_distance_m  = Column(Float, default=0.0)
    home_avg_press_dist    = Column(Float, default=0.0)  # 압박 평균 거리
    away_avg_press_dist    = Column(Float, default=0.0)

    # AI 경기 총평
    match_summary_text     = Column(Text, default="")

    created_at = Column(DateTime, default=datetime.utcnow)
    match = relationship("Match", back_populates="match_analytics")
