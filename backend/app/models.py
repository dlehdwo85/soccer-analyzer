from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, String, Text
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
    home_gk_color     = Column(String(20), nullable=True)
    away_gk_color     = Column(String(20), nullable=True)
    video_filename    = Column(String(512), nullable=True)
    video_url         = Column(String(1024), nullable=True)  # R2 공개 URL 또는 local:{id}/{파일명}
    status            = Column(String(20), default="created")  # created|uploaded|analyzing|done|failed
    data_source       = Column(String(20), default="sample")   # video|gps|sample
    created_at        = Column(DateTime, default=datetime.utcnow)

    # 분석 설정
    home_attacks      = Column(String(10), default="auto")     # auto|right|left (전반 기준)
    halftime_s        = Column(Float, nullable=True)           # 후반 시작 시각(초) — 공격 방향 전환
    calibration_json  = Column(Text, nullable=True)            # 경기장 보정 {preset, image_points, ...}

    # 분석 진행 상태
    analysis_progress = Column(Float, default=0.0)
    analysis_message  = Column(String(255), default="")
    analysis_error    = Column(Text, nullable=True)
    analysis_version  = Column(Integer, default=0)             # 2 = 현재 엔진 결과
    result_meta_json  = Column(Text, nullable=True)            # 길이·fps·경고·공격 방향 등

    players    = relationship("MatchPlayer", back_populates="match", cascade="all, delete-orphan")
    events     = relationship("MatchEvent", back_populates="match", cascade="all, delete-orphan")
    gps_tracks = relationship("GpsTrackPoint", back_populates="match", cascade="all, delete-orphan")


class MatchPlayer(Base):
    """영상에서 추적된 선수(트랙) 하나. stats_json은 합산 가능한 원시값."""
    __tablename__ = "match_players"

    id            = Column(Integer, primary_key=True, index=True)
    match_id      = Column(Integer, ForeignKey("matches.id"), nullable=False, index=True)
    track_id      = Column(String(50), nullable=False)
    team          = Column(String(10), nullable=False)        # home|away
    label         = Column(String(20), default="")            # home|away|home_gk|away_gk
    color_hex     = Column(String(20), nullable=True)         # 실제 관측된 유니폼 색
    thumbnail     = Column(Text, nullable=True)               # JPEG base64
    minor         = Column(Boolean, default=False)            # 짧게 잡힌 조각 트랙
    excluded      = Column(Boolean, default=False)            # 사용자가 제외(코치/관중 등)
    merged_into   = Column(String(50), nullable=True)         # 다른 트랙과 합쳐졌으면 대상 track_id
    display_name  = Column(String(100), nullable=True)
    jersey_number = Column(Integer, nullable=True)
    stats_json    = Column(Text, nullable=False, default="{}")

    match = relationship("Match", back_populates="players")


class MatchEvent(Base):
    """볼 이벤트. player/target은 원래 track_id (병합은 조회 시 반영)."""
    __tablename__ = "match_events"

    id          = Column(Integer, primary_key=True, index=True)
    match_id    = Column(Integer, ForeignKey("matches.id"), nullable=False, index=True)
    seq         = Column(Integer, nullable=False)
    kind        = Column(String(20), nullable=False)          # possession|pass|shot|recovery
    t           = Column(Float, nullable=False)
    t_end       = Column(Float, nullable=True)
    team        = Column(String(10), nullable=False)
    player      = Column(String(50), nullable=False)
    target      = Column(String(50), nullable=True)
    x           = Column(Float, nullable=True)
    y           = Column(Float, nullable=True)
    x2          = Column(Float, nullable=True)
    y2          = Column(Float, nullable=True)
    success     = Column(Boolean, nullable=True)
    detail_json = Column(Text, default="{}")

    match = relationship("Match", back_populates="events")


class GpsTrackPoint(Base):
    """GPS 원본 좌표 (시각화·재분석용)."""
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
    norm_x         = Column(Float, default=0.5)
    norm_y         = Column(Float, default=0.5)

    match = relationship("Match", back_populates="gps_tracks")
