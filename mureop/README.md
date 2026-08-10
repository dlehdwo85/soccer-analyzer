# — 무렵 (MUREOP) 브랜드 런칭 사이트

리드 디퓨저 브랜드 '무렵'의 자사몰 프론트엔드 프로토타입.
빌드 도구 없는 정적 사이트 — 폴더째 어디에든 올리면 동작합니다.

## 로컬에서 보기

```bash
cd mureop
python3 -m http.server 8000
# http://localhost:8000
```

## 구조

```
mureop/
├── index.html            # Home — 브랜드 첫인상, 서사, 향 탐색, 리필, 선물
├── fragrance.html        # 세 가지 무렵 — 카드, 비교표, 나의 무렵 찾기
├── product-summer.html   # 여름 끝 무렵 (무화과·자몽·삼나무)
├── product-rain.html     # 비 갠 무렵 (젖은 흙·풀·베티버)
├── product-sunset.html   # 해 질 무렵 (앰버·머스크·우디)
├── gift.html             # 선물 — 기프트셋 미니 3종
├── refill.html           # 리필 — 다시 걸어두기
├── about.html            # 무렵에 대하여
├── css/style.css         # 디자인 시스템 (토큰·타이포·컴포넌트)
├── js/main.js            # 시간대 인식, 리빌, 찾기 UX, 아코디언, 스티키 CTA, 이벤트 스텁
└── docs/MASTER_PLAN.md   # MUREOP Brand Website Master Plan (전략 문서, 30개 항목)
```

## 배포 (Vercel)

Vercel 프로젝트 루트가 `frontend/`이므로, 사이트 파일을 `frontend/public/`에 복사해 배포합니다.
`frontend/next.config.js`의 rewrite가 `/`를 무렵 홈(`index.html`)으로 연결합니다.
이 폴더(`mureop/`)가 원본이며, 수정 후에는 아래 명령으로 동기화하십시오.

```bash
cp mureop/*.html mureop/favicon.svg frontend/public/
cp -r mureop/css mureop/js frontend/public/
```

기존 사커 분석가 앱은 삭제하지 않았으며 `/matches`, `/players` 경로에 남아 있습니다.

## 알아둘 것

- **"확인 필요" 마커**: 브랜드 기획서에 없는 사실(성분, 사용 기간, 배송 정책, 사업자 정보 등)은
  임의로 작성하지 않고 `todo-mark` 클래스로 표시해 두었습니다. 정보 확정 후 일괄 교체하십시오.
- **이미지**: 실제 촬영 전이므로 CSS 그라디언트 장면 + SVG 병 실루엣으로 연출했습니다.
  촬영 리스트는 `docs/MASTER_PLAN.md` §24 참조.
- **결제**: 프로토타입에는 커머스 백엔드가 없습니다. 구매 버튼은 dataLayer 이벤트만 적재합니다.
  연동 방안은 `docs/MASTER_PLAN.md` §27 참조.
- **Analytics**: 모든 핵심 이벤트가 `window.dataLayer`에 적재됩니다. GTM/GA4 연결만 하면 수집 시작.
