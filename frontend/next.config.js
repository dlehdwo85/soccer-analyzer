/** @type {import('next').NextConfig} */
const nextConfig = {
  // Vercel은 기본 설정으로 배포 가능 (output 별도 설정 불필요)
  // 환경변수는 Vercel 대시보드에서 NEXT_PUBLIC_API_URL로 입력
  async rewrites() {
    return {
      // 루트를 무렵(MUREOP) 정적 사이트로 연결.
      // 무렵 사이트 원본은 저장소 루트의 mureop/ — 수정 후 frontend/public/에 복사해 배포.
      // 기존 사커 분석가 앱은 /matches, /players 경로에 그대로 남아 있음.
      beforeFiles: [{ source: '/', destination: '/index.html' }],
    }
  },
}
module.exports = nextConfig
