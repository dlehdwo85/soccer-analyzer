/**
 * 설치된 Next.js가 지원되는 보안 패치 라인(>= 15.5.21) 미만으로
 * 회귀하는 것을 막는 가드. CI와 로컬(npm run check:next)에서 실행.
 * 근거: 2026-07-21 Next.js 보안 릴리스 — 15.5.21(Maintenance LTS) 미만은
 * GHSA-m99w-x7hq-7vfj 등 HIGH 권고에 노출됨.
 */
const MIN = [15, 5, 21];

const version = require("next/package.json").version;
const parts = version.split("-")[0].split(".").map(Number);

let ok = false;
for (let i = 0; i < 3; i++) {
  if (parts[i] > MIN[i]) { ok = true; break; }
  if (parts[i] < MIN[i]) { ok = false; break; }
  if (i === 2) ok = true; // 완전히 동일
}

if (!ok) {
  console.error(
    `[assert-supported-next] next@${version} 은 지원 최소 버전 ${MIN.join(".")} 미만입니다. ` +
      "보안 패치가 적용된 지원 라인으로 업그레이드하십시오."
  );
  process.exit(1);
}
console.log(`[assert-supported-next] next@${version} OK (>= ${MIN.join(".")})`);
