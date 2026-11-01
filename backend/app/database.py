import logging
import os

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

logger = logging.getLogger(__name__)

# 우선순위: DATABASE_URL 환경변수 → SQLite 로컬 파일
DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./soccer_analyzer.db")

# Railway PostgreSQL은 "postgres://" 형식 → SQLAlchemy는 "postgresql://" 필요
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(DATABASE_URL, connect_args=connect_args, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _literal_default(col):
    d = col.default
    if d is None or not getattr(d, "is_scalar", False):
        return None
    v = d.arg
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, str):
        return "'" + v.replace("'", "''") + "'"
    return None


def add_missing_columns(bind=None) -> list:
    """모델에는 있고 DB 테이블에는 없는 컬럼을 추가한다 (기존 배포 DB 업그레이드용).

    컬럼 삭제·타입 변경은 하지 않는다. 추가된 컬럼 목록을 돌려준다.
    """
    bind = bind or engine
    insp = inspect(bind)
    existing_tables = set(insp.get_table_names())
    added = []
    with bind.begin() as conn:
        for table in Base.metadata.sorted_tables:
            if table.name not in existing_tables:
                continue
            have = {c["name"] for c in insp.get_columns(table.name)}
            for col in table.columns:
                if col.name in have:
                    continue
                ddl = f'ALTER TABLE {table.name} ADD COLUMN {col.name} {col.type.compile(dialect=bind.dialect)}'
                default = _literal_default(col)
                if default is not None:
                    ddl += f" DEFAULT {default}"
                conn.execute(text(ddl))
                added.append(f"{table.name}.{col.name}")
    if added:
        logger.info("컬럼 추가: %s", ", ".join(added))
    return added


def create_tables():
    from app import models  # noqa: F401 — 모델 등록
    Base.metadata.create_all(bind=engine)
    add_missing_columns()
