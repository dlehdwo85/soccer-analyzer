import logging
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from app.database import create_tables
from app.routers import matches as matches_router
from app.routers.matches import players_router

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting up — creating DB tables...")
    create_tables()
    _run_safe_migrations()
    logger.info("DB ready.")
    yield
    logger.info("Shutdown.")


def _run_safe_migrations():
    """앱 시작 시 안전하게 새 컬럼을 추가 (이미 있으면 무시)."""
    from app.database import engine
    from sqlalchemy import text
    try:
        with engine.begin() as conn:
            if engine.dialect.name == "postgresql":
                conn.execute(text(
                    "ALTER TABLE matches ADD COLUMN IF NOT EXISTS data_source VARCHAR(20) DEFAULT 'sample'"
                ))
            else:
                try:
                    conn.execute(text(
                        "ALTER TABLE matches ADD COLUMN data_source VARCHAR(20) DEFAULT 'sample'"
                    ))
                except Exception:
                    pass  # 이미 존재
        logger.info("마이그레이션 완료")
    except Exception as e:
        logger.warning(f"마이그레이션 스킵 (무시 가능): {e}")


app = FastAPI(
    title="Football Analyzer API",
    version="1.0.0",
    description="""
## 조기축구 경기 분석 API

### 주요 기능
- 경기 생성 / 조회 / 삭제
- 영상 업로드 (MP4, MOV)
- 색상 + 위치 기반 선수 추적 분석
- 샘플 데이터로 즉시 실행 가능
""",
    lifespan=lifespan,
)

# ── CORS 설정 ──────────────────────────────────────────────────────────────
# ALLOWED_ORIGINS 환경변수로 배포 도메인을 쉼표 구분으로 지정
# 예) ALLOWED_ORIGINS=https://my-app.vercel.app,https://custom-domain.com
_raw_origins = os.environ.get(
    "ALLOWED_ORIGINS",
    "http://localhost:3000,http://127.0.0.1:3000",
)
ALLOWED_ORIGINS = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(matches_router.router)
app.include_router(players_router)


@app.get("/api/health", tags=["system"])
def health():
    return {
        "status": "ok",
        "service": "Football Analyzer API",
        "allowed_origins": ALLOWED_ORIGINS,
    }


@app.get("/", include_in_schema=False)
def root():
    return {"message": "Football Analyzer API", "docs": "/docs"}
