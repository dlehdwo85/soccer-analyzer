import logging
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from app.database import create_tables
from app.routers import matches as matches_router
from app.routers.matches import players_router, videos_router
from app.routers import teams as teams_router
from app.routers import auth as auth_router
from app.routers import billing as billing_router

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting up — creating/upgrading DB tables...")
    create_tables()
    from app.services.analysis_service import recover_interrupted
    n = recover_interrupted()
    if n:
        logger.warning("중단된 분석 %d건을 실패로 표시", n)
    logger.info("DB ready.")
    yield
    logger.info("Shutdown.")


app = FastAPI(
    title="Football Analyzer API",
    version="2.0.0",
    description="""
## 조기축구 경기 영상 분석 API

- 유니폼 색으로 선수 팀 구분 (골키퍼·심판 포함)
- 선수별 볼 터치·점유·패스 성공/실패·키패스·유효 슈팅·xG·가로채기·볼 탈취
- 이벤트 검수(수정·삭제·추가), 전반/후반 나눠 보기
- 트랙 병합/이름 지정/제외, CSV 내보내기, 예전에 올린 영상 다시 분석
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
app.include_router(videos_router)
app.include_router(teams_router.router)
app.include_router(auth_router.router)
app.include_router(billing_router.router)


@app.get("/api/health", tags=["system"])
def health():
    from app.services.analysis_service import engines
    return {
        "status": "ok",
        "service": "Football Analyzer API",
        "version": app.version,
        "engines": engines(),
        "r2": bool(os.environ.get("R2_ACCESS_KEY_ID") and os.environ.get("R2_ENDPOINT")),
    }


@app.get("/", include_in_schema=False)
def root():
    return {"message": "Football Analyzer API", "docs": "/docs"}
