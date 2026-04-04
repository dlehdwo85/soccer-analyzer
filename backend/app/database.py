import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase

# ── DB URL 결정 ────────────────────────────────────────────────────────────
# 우선순위: DATABASE_URL 환경변수 → SQLite 로컬 파일
DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./soccer_analyzer.db")

# Railway PostgreSQL은 "postgres://" 형식 → SQLAlchemy는 "postgresql://" 필요
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

# SQLite는 멀티스레드 제한 옵션 필요, PostgreSQL은 불필요
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def create_tables():
    from app.models import Match, PlayerTrackSummary, FrameTracking, MatchAnalytics  # noqa
    from app.models import GpsTrackPoint, PlayerProfile  # noqa — GPS 신규 테이블
    Base.metadata.create_all(bind=engine)
