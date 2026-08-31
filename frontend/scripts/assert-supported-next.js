/**
 * 설치된 Next.js가 지원되는 보안 패치 라인(>= 15.5.24) 미만으로
 * 회귀하는 것을 막는 가드. CI와 로컬(npm run check:next)에서 실행.
 * 근거: 2026-08-25 Next.js 보안 릴리스 — 15.5.24(Maintenance LTS) 미만
 * 15.x(15.5.21~15.5.23 포함)는 Critical 권고에 노출됨.
 * 테스트용으로 버전을 인자로 받을 수 있음:
 *   node scripts/assert-supported-next.js [version]
 */
const MIN = [15, 5, 24];

function isSupported(version) {
  const parts = version.split("-")[0].split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (parts[i] > MIN[i]) return true;
    if (parts[i] < MIN[i]) return false;
  }
  return true; // 완전히 동일
}

module.exports = { MIN, isSupported };

if (require.main === module) {
  const version = process.argv[2] || require("next/package.json").version;
  if (!isSupported(version)) {
    console.error(
      `[assert-supported-next] next@${version} 은 지원 최소 버전 ${MIN.join(".")} 미만입니다. ` +
        "보안 패치가 적용된 지원 라인으로 업그레이드하십시오."
    );
    process.exit(1);
  }
  console.log(`[assert-supported-next] next@${version} OK (>= ${MIN.join(".")})`);
}
