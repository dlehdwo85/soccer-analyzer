from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from app.database import Base


class Team(Base):
    """우리 팀. 명단(등번호·이름)을 두고 경기마다 홈/원정 팀으로 연결해 시즌 기록을 모은다."""
    __tablename__ = "teams"

    id          = Column(Integer, primary_key=True, index=True)
    name        = Column(String(100), nullable=False)
    color       = Column(String(20), default="#56b4d3")
    roster_json = Column(Text, nullable=False, default="[]")   # [{"number": 10, "name": "홍길동"}]
    created_at  = Column(DateTime, default=datetime.utcnow)
    invite_code = Column(String(24), nullable=True, index=True)  # 팀 초대 링크 코드 (관리자가 만들고 바꿀 수 있다)


class User(Base):
    """카카오 로그인 사용자."""
    __tablename__ = "users"

    id            = Column(Integer, primary_key=True, index=True)
    kakao_id      = Column(String(40), unique=True, nullable=False, index=True)
    nickname      = Column(String(100), nullable=True)
    profile_image = Column(String(1024), nullable=True)
    created_at    = Column(DateTime, default=datetime.utcnow)
    last_login_at = Column(DateTime, nullable=True)


class TeamMember(Base):
    """팀 소속과 권한. owner(팀장) > manager(운영진: 명단·경기 정리) > member(팀원: 보기)."""
    __tablename__ = "team_members"

    id         = Column(Integer, primary_key=True, index=True)
    team_id    = Column(Integer, nullable=False, index=True)
    user_id    = Column(Integer, nullable=False, index=True)
    role       = Column(String(10), nullable=False, default="member")
    created_at = Column(DateTime, default=datetime.utcnow)


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
    data_source       = Column(String(20), default="sample")   # video|sample (예전 gps)
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
    overlay_gz        = Column(Text, nullable=True)            # 영상 검수용 프레임별 선수 박스·공 위치 (gzip+base64 JSON)
    web_video_url     = Column(String(1024), nullable=True)    # 브라우저 재생용 사본 (720p H.264, faststart)
    runpod_job_id     = Column(String(64), nullable=True)      # GPU 서버(RunPod)에 맡긴 작업 번호 — 상태 조회 때 확인
    analysis_quality  = Column(String(20), nullable=True)      # standard | max
    ai_summary_json   = Column(Text, nullable=True)            # AI 경기 요약 + MOM 후보
    ai_summary_at     = Column(DateTime, nullable=True)
    ai_summary_basis  = Column(String(64), nullable=True)      # 요약에 쓴 기록 해시 — 기록이 바뀌면 다시 요약
    home_team_id      = Column(Integer, nullable=True, index=True)   # 등록된 팀(teams.id) — 명단·시즌 기록
    free_trial        = Column(Boolean, default=False)                 # 팀의 첫 경기 무료 혜택을 쓴 경기
    notify_phone      = Column(String(20), nullable=True)              # 분석이 끝나면 알림톡 받을 번호 (보내면 지운다)
    away_team_id      = Column(Integer, nullable=True, index=True)

    players    = relationship("MatchPlayer", back_populates="match", cascade="all, delete-orphan")
    events     = relationship("MatchEvent", back_populates="match", cascade="all, delete-orphan")


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

    # AI 선수 분석 (병합 대표 트랙에 저장). basis = 분석에 쓴 기록의 해시 — 기록이 바뀌면 달라진다
    ai_report_json  = Column(Text, nullable=True)
    ai_report_at    = Column(DateTime, nullable=True)
    ai_report_basis = Column(String(64), nullable=True)

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
    deleted     = Column(Boolean, default=False)              # 사용자가 잘못 잡힌 이벤트로 지움
    manual      = Column(Boolean, default=False)              # 사용자가 직접 추가
    edited      = Column(Boolean, default=False)              # 사용자가 선수·결과를 고침

    match = relationship("Match", back_populates="events")


class Payment(Base):
    """나이스페이 결제. 주문을 먼저 만들고(pending), 결제창 인증 뒤 서버가 승인하면 done."""
    __tablename__ = "payments"

    id          = Column(Integer, primary_key=True, index=True)
    order_id    = Column(String(64), unique=True, nullable=False, index=True)
    user_id     = Column(Integer, nullable=True, index=True)
    product     = Column(String(20), nullable=False)               # match | team_month
    match_id    = Column(Integer, nullable=True, index=True)       # 경기권이면 그 경기
    team_id     = Column(Integer, nullable=True, index=True)       # 팀 월 이용권이면 그 팀
    amount      = Column(Integer, nullable=False)
    status      = Column(String(20), default="pending")            # pending | done | failed
    payment_key = Column(String(200), nullable=True)               # 나이스페이 TID
    approved_at = Column(DateTime, nullable=True)
    raw_json    = Column(Text, nullable=True)                      # 승인 응답 요약 (영수증 확인용)
    return_path = Column(String(500), nullable=True)               # 결제 뒤 돌아갈 사이트 경로
    pg_mode     = Column(String(10), nullable=True)                # test | live (나이스페이 상점)
    created_at  = Column(DateTime, default=datetime.utcnow)
