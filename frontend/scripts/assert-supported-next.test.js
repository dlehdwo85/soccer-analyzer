/**
 * assert-supported-next 가드의 회귀 테스트.
 * 취약 라인(15.5.23 이하)은 거부, 패치 라인(15.5.24 이상)은 허용을 보장한다.
 * 실행: npm run test:check-next
 */
const assert = require("assert");
const { isSupported } = require("./assert-supported-next");

const rejected = ["14.2.3", "14.2.35", "15.5.21", "15.5.23"];
const accepted = ["15.5.24", "15.5.25", "15.6.0", "16.2.11", "16.3.3"];

for (const v of rejected) {
  assert.strictEqual(isSupported(v), false, `next@${v} 는 거부되어야 합니다`);
}
for (const v of accepted) {
  assert.strictEqual(isSupported(v), true, `next@${v} 는 허용되어야 합니다`);
}

// 실제 설치본도 가드를 통과해야 한다
const installed = require("next/package.json").version;
assert.strictEqual(isSupported(installed), true, `설치된 next@${installed} 가 가드를 통과하지 못합니다`);

console.log(
  `[assert-supported-next.test] OK — 거부 ${rejected.length}건, 허용 ${accepted.length}건, 설치본 next@${installed} 통과`
);
