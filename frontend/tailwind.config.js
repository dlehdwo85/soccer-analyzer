/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        // 경기장 야간 조명 느낌의 어두운 바탕 + 형광 라임 포인트
        ink: {
          950: '#070b14',
          900: '#0d1321',
          850: '#111a2c',
          800: '#18223a',
          700: '#243052',
          600: '#34416a',
          500: '#66749a',
          400: '#8a97ba',
          300: '#b4bed6',
          200: '#d5dcec',
          100: '#eef2fa',
        },
        volt: {
          DEFAULT: '#c8f031',
          600: '#a9d118',
          soft: 'rgba(200,240,49,0.12)',
        },
      },
      fontFamily: {
        sans: ['Pretendard Variable', 'Pretendard', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(200,240,49,.35), 0 8px 30px -10px rgba(200,240,49,.35)',
      },
    },
  },
  plugins: [],
}
