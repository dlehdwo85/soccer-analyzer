import logging
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from app.database import create_tables
from app.routers import matches as matches_router

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting up — creating DB tables...")
    create_tables()
    logger.info("DB ready.")
    yield
    logger.info("Shutdown.")


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
