# ⚽ 풋볼 애널라이저

조기축구 경기 영상을 올리면 **유니폼 색으로 선수를 팀별로 나누고**, 공의 움직임을 따라
**선수마다 볼 터치·패스 성공/실패·키패스·유효 슈팅·가로채기·볼 탈취**를 기록하는 웹앱입니다.
잘못 잡힌 장면은 영상을 보며 바로 고칠 수 있고, 예전에 올린 영상도 다시 분석할 수 있습니다.

| 화면 | 내용 |
|------|------|
| 개요 | 유효 슈팅 스코어, 점유율, 팀 비교(패스·성공률·전진 패스·키패스·슈팅·xG·가로채기·탈취), 부문별 1위, 점유 흐름, 슈팅 지도 |
| 선수 기록 | 정렬 가능한 선수별 기록 표 (CSV 내보내기) |
| 선수 상세 | 패스 지도(성공/실패), 슈팅·수비 지도, 이벤트 목록(누르면 장면 재생) |
| 하이라이트 | 슈팅과 그 슈팅을 만든 키패스 장면 카드, 연속 재생 |
| 이벤트 검수 | 영상 보며 선수·결과 고치기, 잘못 잡힌 이벤트 지우기, 놓친 이벤트 추가 — 모든 수치 즉시 재계산 |
| 선수 비교 | 두 선수 기록 나란히 비교 |
| 패스 네트워크 | 평균 위치 + 선수 간 패스 연결 굵기, 가장 많이 주고받은 조합 |
| 이벤트 | 슈팅/패스/패스 실패/볼 탈취 타임라인 — 누르면 해당 장면 영상 재생 |
| 전반/후반 | 경기 설정에 후반 시작 시각을 넣으면 모든 화면을 전·후반으로 나눠 봄 |
| 영상 보관함 | 영상이 연결된 경기와 R2 저장소에만 남은 영상 목록 — 예전에 올린 영상을 새 엔진으로 다시 분석 |
| 선수 정리 | 영상에서 잘라낸 썸네일을 보고 이름·등번호 지정, 팀 변경, 제외, 같은 선수 트랙 합치기/분리 |
| 선수 프로필 | 이름 붙인 선수의 여러 경기 누적 기록 |

---

## 어떻게 분석하나

```
영상 ─▶ YOLO 사람·공 검출 ─▶ 유니폼 색 분류 ─▶ 팀 인식 추적 ─▶ 경기장 좌표 변환 ─▶ 공 점유 판정 ─▶ 이벤트·통계
```

1. **유니폼 색 분류** (`backend/app/vision/color.py`) — 선수 상체 픽셀을 LAB 색공간에서 비교합니다.
   잔디색 픽셀은 버리고, 줄무늬 유니폼도 픽셀 비율로 판정합니다. 경기 설정의 색이 대략만 맞아도
   분석 초반 30초 동안 실제 영상의 색 군집으로 자동 보정합니다. 홈/원정/양 팀 골키퍼/심판/기타로 나누며
   심판·관중·코치는 기록에서 빠집니다.
2. **추적** (`tracker.py`) — IoU 2단계 매칭(ByteTrack 방식) + 팀이 다른 사람끼리는 ID가 바뀌지 않게 막고,
   가려졌다 다시 나타난 같은 팀 선수 조각 트랙을 위치·색으로 이어 붙입니다.
3. **경기장 좌표** (`pitch.py`) — 경기장 네 점을 찍으면(보정) 화면 → 실제 미터 변환. 보정이 없으면 선수 키(1.75m)로 축척을 추정합니다.
4. **공·이벤트** (`ball.py`, `events.py`) — 공 후보 중 물리적으로 가능한 것만 골라 보간하고, 공이 선수 발밑에 머무는 구간(점유)을 찾습니다.
   점유가 같은 팀 선수에게 넘어가면 패스 성공, 상대에게 넘어가면 패스 실패(차단), 공이 밖으로 나가면 패스 실패(아웃),
   빠른 공이 골문 쪽으로 향하면 슈팅(골문 안 = 유효), 상대 점유를 끊고 가져오면 볼 탈취입니다.
   슈팅마다 거리·각도로 **xG(기대 득점)**를 추정합니다.
5. **통계** (`stats.py`) — 선수별 볼 기록을 더하고, 패스를 받은 선수가 8초 안에 슈팅하면 패스한 선수에게 **키패스**를 줍니다.
   이동거리·속도·뛴 영역은 영상만으로는 정확히 재기 어려워(원근·카메라 이동·가려짐) 계산하지 않습니다.
   위치는 출전 시간과 패스 네트워크용 평균 위치에만 씁니다.

결과는 원시값으로 저장하고 화면을 열 때 다시 계산하므로, **선수 정리에서 트랙을 합치거나 팀을 바꾸면 모든 수치가 즉시 일관되게 바뀝니다.**

### 정확도와 한계

- 가상 경기 시뮬레이터(`simulate.py`, 정답 이벤트 포함)로 검증합니다. 시뮬레이션 기준 패스 검출 재현율·정밀도 약 97~100%,
  점유 판정 약 99%, 슈팅 재현율 약 80~93%, 볼 탈취 약 86%입니다(`backend/tests`). **실제 영상의 정확도는 촬영 조건에 따라 크게 달라지며 아직 실제 경기 영상으로 측정한 수치는 없습니다.**
- 가장 좋은 영상: **높은 곳에서 경기장 전체를 담은 고정 카메라**, 720p 이상. 카메라가 따라 움직이거나 확대/축소하면 위치 기반 판정(전진 패스·슈팅 위치)이 부정확해집니다.
- 공이 작게 찍히거나 자주 가려지면 볼 이벤트가 덜 잡힙니다(결과 화면에 공 검출 비율과 경고가 표시됨).
- 등번호는 읽지 않습니다. 선수 정리 화면에서 썸네일을 보고 이름·번호를 붙여 주세요.
- 같은 팀이 비슷한 색이거나 두 팀 유니폼 색이 비슷하면 팀 구분이 어렵습니다. 골키퍼 색을 따로 지정하면 도움이 됩니다.

---

## 분석 모드

| 모드 | 설명 | 필요한 것 |
|------|------|-----------|
| 영상 분석 (RunPod) | GPU 서버에서 영상 분석. 90분 경기 약 15~30분 | `RUNPOD_API_KEY`, `RUNPOD_ENDPOINT_ID`, 영상이 R2에 있어야 함 |
| 영상 분석 (서버 직접) | 백엔드 서버에 `requirements-worker.txt` 설치 시. CPU는 매우 느림 | GPU 서버 또는 짧은 영상 |
| 샘플 분석 | 가상 경기로 결과 화면 미리보기. **업로드 영상과 무관**하며 결과 화면에 명시됨 | 없음 |

영상 분석 엔진이 설정되지 않았으면 분석 버튼이 비활성화되고 API는 503을 돌려줍니다. 예전처럼 샘플 데이터로 몰래 대체하지 않습니다.

---

## 배포 (GitHub → Railway + Vercel + RunPod)

### 1. Railway — 백엔드

1. https://railway.app → New Project → Deploy from GitHub repo → 이 저장소, **Root Directory `backend`**
2. PostgreSQL 플러그인 추가 (`DATABASE_URL` 자동 설정)
3. Variables:

| 변수 | 값 |
|------|----|
| `ALLOWED_ORIGINS` | Vercel 주소 (예: `https://soccer-analyzer.vercel.app`) |
| `RUNPOD_API_KEY`, `RUNPOD_ENDPOINT_ID` | 3단계에서 발급 |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, `R2_BUCKET`, `R2_PUBLIC_URL` | Cloudflare R2 (대용량 영상 직접 업로드) |

`https://백엔드주소/api/health`에서 `engines.runpod`, `r2`가 `true`인지 확인합니다.
DB 테이블과 새 컬럼은 시작할 때 자동으로 만들어집니다(이전 버전 DB도 그대로 업그레이드). 이전 버전 분석 결과는 다시 분석해야 합니다.

### 2. Vercel — 프론트엔드

Add New Project → 이 저장소 → **Root Directory `frontend`** → 환경변수 `NEXT_PUBLIC_API_URL` = Railway 주소 → Deploy

### 3. RunPod — GPU 분석 워커

```bash
docker build -f backend/Dockerfile.worker -t <레지스트리>/soccer-analyzer-worker:latest backend
docker push <레지스트리>/soccer-analyzer-worker:latest
```

RunPod 콘솔 → Serverless → New Endpoint → 위 이미지 지정 (GPU 16GB 이상 권장, 최소 워커 0이면 쓰지 않을 때 비용 없음).
환경변수로 `YOLO_MODEL`(기본 `yolov8m.pt`), `YOLO_IMGSZ`(기본 1280)를 바꿀 수 있습니다. 발급된 Endpoint ID와 API 키를 Railway에 넣습니다.

> 워커는 [Ultralytics YOLO](https://github.com/ultralytics/ultralytics)(AGPL-3.0)를 사용합니다. 서비스를 외부에 제공할 때는 AGPL 조건이나 Ultralytics 상용 라이선스를 확인하세요.

### 4. Cloudflare R2 CORS

브라우저가 R2로 직접 올리므로 버킷 CORS에 Vercel 주소의 `PUT`을 허용해야 합니다.
R2를 쓰지 않으면 영상이 백엔드 서버 디스크에 저장되며(Railway는 볼륨 필요), 이 경우 RunPod는 영상을 받을 수 없어 서버 직접 분석만 가능합니다.

---

## 사용 순서

1. **새 경기 등록** — 팀 이름, 유니폼 색(필요하면 골키퍼·심판 색), 전반 공격 방향, 후반 시작 시각
2. **영상 올리기**
3. **경기장 보정**(권장) — 네 점이 보이는 장면에서 코너(또는 하프라인 끝)를 순서대로 클릭, 실제 구장 크기 입력
4. **분석 시작** — 처음엔 '일부 구간만 분석'으로 5~10분만 돌려 색·보정이 맞는지 확인하면 빠릅니다
5. **선수 정리** — 썸네일 보고 이름·번호 지정, 나뉜 트랙 합치기, 벤치·관중 제외
6. 결과 확인, CSV 내보내기

---

## 로컬 개발

```bash
# 백엔드
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements-dev.txt
uvicorn main:app --reload --port 8000
pytest -q                      # 비전 엔진·파이프라인·API 테스트

# 실제 영상까지 로컬에서 분석하려면 (YOLO 설치, GPU 권장)
pip install -r requirements-worker.txt

# 프론트엔드
cd frontend
npm install
npm run dev                    # http://localhost:3000
npm run typecheck && npm run build
```

`docker-compose up --build`로 둘 다 띄울 수도 있습니다.

---

## 폴더 구조

```
backend/
├── main.py                    FastAPI 앱 (시작 시 DB 생성·업그레이드)
├── worker_handler.py          RunPod 워커 진입점
├── Dockerfile / Dockerfile.worker
├── requirements.txt           백엔드 서버
├── requirements-worker.txt    영상 분석(YOLO) 추가 의존성
├── app/
│   ├── vision/                분석 엔진 (서버·워커 공용)
│   │   ├── color.py           유니폼 색 분류·자동 보정
│   │   ├── tracker.py         팀 인식 추적·트랙 이어붙이기
│   │   ├── ball.py            공 위치 선택·보간
│   │   ├── pitch.py           경기장 보정(호모그래피)
│   │   ├── events.py          점유·패스·슈팅·탈취·xG
│   │   ├── stats.py           선수·팀 통계, 패스 네트워크, 점유 흐름
│   │   ├── simulate.py        정답이 있는 가상 경기 (테스트·샘플)
│   │   └── pipeline.py        영상 → 결과
│   ├── services/              분석 실행, 결과 저장/재계산, RunPod, R2
│   └── routers/matches.py     API
└── tests/
frontend/src/
├── app/                       경기 목록·등록·상세, 결과, 선수 프로필
├── components/results/        결과 화면 구성 요소
├── components/match/          경기 설정 폼, 경기장 보정 도구
└── components/pitch/          경기장 SVG (화살표)
```

## 주요 API

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/api/matches` | 경기 생성 |
| PATCH / DELETE | `/api/matches/{id}` | 설정 수정 / 삭제 |
| GET | `/api/matches/{id}/upload-url` | R2 직접 업로드 URL (R2 없으면 404) |
| POST | `/api/matches/{id}/upload` | 서버로 업로드 |
| PUT / DELETE | `/api/matches/{id}/calibration` | 경기장 보정 |
| POST | `/api/matches/{id}/analyze` | `{"mode": "video" \| "sample", "start_seconds", "max_seconds"}` |
| GET | `/api/matches/{id}/status` | 진행률·오류 |
| GET | `/api/matches/{id}/result` | 선수·팀 통계, 이벤트, 패스 네트워크, 점유 흐름 |
| PATCH | `/api/matches/{id}/players/{track}` | 이름·번호·팀·제외 |
| POST | `/api/matches/{id}/players/merge` | 트랙 합치기 (`/unmerge`로 분리) |
| GET | `/api/matches/{id}/export.csv` | 선수 기록 CSV |
| PATCH / POST | `/api/matches/{id}/events/{eid}`, `/api/matches/{id}/events` | 이벤트 고치기·지우기 / 추가 (`/events/reset`으로 되돌리기) |
| GET | `/api/matches/{id}/result?period=1` | 전반(1)·후반(2)만 |
| GET | `/api/videos` | 영상 보관함 (R2에만 남은 영상 포함) |
| GET | `/api/players`, `/api/players/{이름}` | 선수 누적 프로필 |

전체 문서: `https://백엔드주소/docs`
