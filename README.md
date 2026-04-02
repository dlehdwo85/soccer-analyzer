# ⚽ 풋볼 애널라이저

조기축구 경기 영상으로 선수별 이동거리·활동 범위·포지션을 자동 분석하는 웹앱입니다.

---

## 🌐 배포 방법 (GitHub → Vercel + Railway)

> 개발 지식 없이 따라할 수 있습니다. 총 소요시간 약 20~30분.

---

### 준비물 (모두 무료)

| 서비스 | 용도 | 가입 주소 |
|--------|------|----------|
| GitHub | 코드 저장소 | https://github.com |
| Vercel | 프론트엔드 배포 | https://vercel.com |
| Railway | 백엔드 배포 | https://railway.app |

---

## 📤 3단계: GitHub 업로드

### 3-1. GitHub 저장소 만들기

1. https://github.com 로그인
2. 오른쪽 상단 **+** 버튼 → **New repository** 클릭
3. Repository name: `soccer-analyzer` 입력
4. **Public** 선택 (무료 배포에 필요)
5. **Create repository** 클릭

### 3-2. 코드 올리기

터미널(맥: 터미널 앱 / 윈도우: PowerShell)을 열고 아래를 순서대로 입력합니다.

**Git이 없다면 먼저 설치:** https://git-scm.com/downloads

```bash
# soccer-analyzer 폴더로 이동
cd soccer-analyzer

# Git 초기화
git init

# 모든 파일 준비
git add .

# 첫 커밋
git commit -m "첫 번째 업로드"

# GitHub 저장소 연결 (YOUR_USERNAME을 본인 GitHub 아이디로 교체)
git remote add origin https://github.com/YOUR_USERNAME/soccer-analyzer.git

# 업로드
git push -u origin main
```

> ✅ GitHub 저장소에 파일들이 보이면 성공입니다.

---

## 🚂 4단계: Railway — 백엔드 배포

### 4-1. Railway 프로젝트 생성

1. https://railway.app 접속 → **GitHub로 로그인**
2. **New Project** 클릭
3. **Deploy from GitHub repo** 클릭
4. `soccer-analyzer` 저장소 선택
5. **Add service** 화면에서 **backend 폴더**를 선택

> Railway가 자동으로 Python을 감지하고 배포를 시작합니다.

### 4-2. 환경변수 설정

Railway 대시보드에서 백엔드 서비스 클릭 → **Variables** 탭 → **+ New Variable**:

| 변수 이름 | 값 | 설명 |
|----------|---|------|
| `ALLOWED_ORIGINS` | (Vercel 배포 후 입력) | 프론트엔드 주소 (나중에 추가) |
| `DATABASE_URL` | (자동 설정됨) | PostgreSQL 연결 주소 |

### 4-3. 배포 주소 확인

배포 완료 후 **Settings** 탭 → **Domains** → 주소 복사
예: `https://soccer-analyzer-backend.up.railway.app`

> ✅ 브라우저에서 `https://your-backend.up.railway.app/api/health` 접속 시
> `{"status":"ok"}` 가 보이면 성공입니다.

---

## ▲ 5단계: Vercel — 프론트엔드 배포

### 5-1. Vercel 프로젝트 생성

1. https://vercel.com 접속 → **GitHub로 로그인**
2. **Add New Project** 클릭
3. `soccer-analyzer` 저장소 선택
4. **Root Directory** 설정: `frontend` 입력 (⚠️ 이 단계 중요!)
5. **Framework Preset**: Next.js 자동 감지됨

### 5-2. 환경변수 설정 (필수!)

같은 화면 아래 **Environment Variables** 섹션:

| 변수 이름 | 값 |
|----------|----|
| `NEXT_PUBLIC_API_URL` | Railway 백엔드 주소 (예: `https://soccer-analyzer-backend.up.railway.app`) |

### 5-3. 배포

**Deploy** 버튼 클릭 → 약 2~3분 후 완료

배포 주소 예: `https://soccer-analyzer.vercel.app`

---

## 🔄 마지막: CORS 설정 완성

Vercel 배포 주소를 받았으면 Railway로 돌아가서:

1. 백엔드 서비스 → **Variables** 탭
2. `ALLOWED_ORIGINS` 값 입력:
   ```
   https://soccer-analyzer.vercel.app,http://localhost:3000
   ```
3. 저장 → Railway가 자동으로 재시작

---

## ✅ 6단계: 배포 후 테스트

| 테스트 | 방법 |
|--------|------|
| 백엔드 작동 확인 | `https://백엔드주소/api/health` 접속 → `{"status":"ok"}` 확인 |
| API 문서 확인 | `https://백엔드주소/docs` 접속 → Swagger UI 표시 확인 |
| 프론트엔드 접속 | `https://앱주소.vercel.app` 접속 → 경기 목록 화면 확인 |
| 샘플 분석 테스트 | 새 경기 등록 → **샘플 경기 데이터로 분석** 클릭 → 결과 화면 확인 |

---

## 🛠 이후 코드 수정 시 재배포 방법

코드를 수정한 후 아래 명령어만 실행하면 Vercel과 Railway가 자동으로 재배포합니다:

```bash
git add .
git commit -m "수정 내용 메모"
git push
```

---

## 📁 폴더 구조

```
soccer-analyzer/
├── .gitignore              ← GitHub에 올리면 안 되는 파일 목록
├── README.md               ← 이 파일
├── docker-compose.yml      ← 로컬 실행용 (배포와 무관)
│
├── frontend/               ← Vercel에 배포되는 Next.js 앱
│   ├── vercel.json         ← Vercel 배포 설정
│   ├── .env.example        ← 환경변수 양식
│   ├── package.json
│   └── src/
│       ├── app/            ← 페이지 (경기 목록, 등록, 상세, 결과)
│       ├── components/     ← UI 컴포넌트 (히트맵, 포지션맵 등)
│       ├── lib/            ← API 클라이언트, 타입 정의
│       └── hooks/          ← React 훅
│
└── backend/                ← Railway에 배포되는 FastAPI 서버
    ├── railway.toml        ← Railway 배포 설정
    ├── Procfile            ← Railway 실행 명령
    ├── runtime.txt         ← Python 버전 명시
    ├── .env.example        ← 환경변수 양식
    ├── requirements.txt    ← Python 패키지 목록
    ├── main.py             ← FastAPI 앱 진입점
    └── app/
        ├── database.py     ← DB 연결 (SQLite/PostgreSQL 자동 전환)
        ├── models.py       ← DB 테이블 정의
        ├── schemas.py      ← API 요청/응답 형식
        ├── routers/        ← API 엔드포인트
        └── services/       ← 분석 로직 (교체 가능한 구조)
```

---

## ❓ 자주 묻는 문제

**Q: Vercel 배포 시 "Build Failed" 오류**
→ Root Directory를 `frontend`로 정확히 입력했는지 확인하세요.

**Q: 앱에 접속했는데 경기 목록이 안 불러와져요**
→ `NEXT_PUBLIC_API_URL`이 정확한 Railway 주소인지 확인하세요.
→ Railway 백엔드가 정상 실행 중인지 `/api/health`로 확인하세요.

**Q: "CORS 오류"가 브라우저 개발자 도구에 보여요**
→ Railway의 `ALLOWED_ORIGINS`에 Vercel 주소를 정확히 추가했는지 확인하세요.

**Q: Railway 배포가 실패해요**
→ Railway 대시보드의 **Deployments** 탭 → 실패한 배포 클릭 → 로그 확인

---

## 💻 로컬에서 실행하는 방법 (개발용)

### Docker 사용 (가장 간단)
```bash
docker-compose up --build
# 브라우저: http://localhost:3000
```

### 직접 실행
```bash
# 백엔드
cd backend
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
uvicorn main:app --reload --port 8000

# 프론트엔드 (새 터미널)
cd frontend
npm install
cp .env.example .env.local
npm run dev
# 브라우저: http://localhost:3000
```

---

## 🔌 다음 확장 포인트

| 기능 | 파일 위치 |
|------|----------|
| YOLO 실제 영상 분석 연결 | `backend/app/services/analysis_service.py` |
| ByteTrack 추적기 교체 | `backend/app/services/tracker_service.py` |
| PostgreSQL 전환 | Railway Variables의 `DATABASE_URL` 변경 |
