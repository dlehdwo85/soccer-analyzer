"""
DB 마이그레이션 스크립트 (One-time run)
========================================
기존 PostgreSQL DB에 새 컬럼/테이블을 추가한다.
Railway 콘솔에서: python migrate.py

추가 항목:
  - matches.data_source (VARCHAR 20, default 'sample')
  - 새 테이블: gps_track_points, player_profiles
"""

import os
import logging
from sqlalchemy import text

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def run_migration():
    from app.database import engine, create_tables

    # 1. 새 테이블 생성 (이미 있으면 무시)
    logger.info("새 테이블 생성 중...")
    create_tables()
    logger.info("테이블 생성 완료")

    # 2. 기존 테이블에 컬럼 추가 (이미 있으면 무시)
    with engine.begin() as conn:
        db_type = engine.dialect.name  # 'postgresql' or 'sqlite'

        if db_type == "postgresql":
            # PostgreSQL: ADD COLUMN IF NOT EXISTS 지원
            conn.execute(text("""
                ALTER TABLE matches
                ADD COLUMN IF NOT EXISTS data_source VARCHAR(20) DEFAULT 'sample'
            """))
            logger.info("matches.data_source 컬럼 추가 완료 (PostgreSQL)")
        else:
            # SQLite: IF NOT EXISTS 미지원 → 에러 무시
            try:
                conn.execute(text(
                    "ALTER TABLE matches ADD COLUMN data_source VARCHAR(20) DEFAULT 'sample'"
                ))
                logger.info("matches.data_source 컬럼 추가 완료 (SQLite)")
            except Exception as e:
                if "duplicate column" in str(e).lower() or "already exists" in str(e).lower():
                    logger.info("matches.data_source 이미 존재 — 스킵")
                else:
                    raise

    logger.info("마이그레이션 완료!")


if __name__ == "__main__":
    run_migration()
