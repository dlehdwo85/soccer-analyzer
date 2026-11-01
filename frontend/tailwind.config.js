/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        // 어두운 남색 바탕 + 절제된 잔디색 포인트
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
          DEFAULT: '#3fa35b',
          600: '#348a4c',
          soft: 'rgba(63,163,91,0.12)',
        },
      },
      fontFamily: {
        sans: ['Pretendard Variable', 'Pretendard', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
