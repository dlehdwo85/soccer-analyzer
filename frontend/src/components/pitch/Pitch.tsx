import { ReactNode } from 'react'

interface Props {
  length: number
  width: number
  children?: ReactNode
  className?: string
  /** 잔디 대신 밝은 배경 */
  light?: boolean
}

/** 경기장 좌표(m)를 그대로 쓰는 SVG. x: 왼쪽 골라인 → 오른쪽, y: 먼 터치라인 → 가까운 터치라인 */
export default function Pitch({ length: L, width: W, children, className, light }: Props) {
  const pad = 2
  const futsal = L < 60
  const boxD = futsal ? 6 : 16.5
  const boxW = futsal ? Math.min(W, 15) : 40.32
  const sixD = futsal ? 0 : 5.5
  const sixW = 18.32
  const goalW = futsal ? 3 : 7.32
  const circle = futsal ? 3 : 9.15
  const spot = futsal ? 6 : 11
  const line = light ? '#cbd5e1' : 'rgba(255,255,255,0.75)'
  const sw = Math.max(0.25, L / 350)
  return (
    <svg viewBox={`${-pad} ${-pad} ${L + pad * 2} ${W + pad * 2}`} className={className} role="img"
      aria-label="경기장">
      <rect x={-pad} y={-pad} width={L + pad * 2} height={W + pad * 2} fill={light ? '#f8fafc' : '#2f7d4a'} rx={1.5} />
      {!light && Array.from({ length: 10 }, (_, i) => (
        <rect key={i} x={(L / 10) * i} y={0} width={L / 10} height={W} fill={i % 2 ? '#2b7444' : '#33854f'} />
      ))}
      <g fill="none" stroke={line} strokeWidth={sw}>
        <rect x={0} y={0} width={L} height={W} />
        <line x1={L / 2} y1={0} x2={L / 2} y2={W} />
        <circle cx={L / 2} cy={W / 2} r={circle} />
        {[0, 1].map(side => {
          const gx = side ? L : 0
          const dir = side ? -1 : 1
          return (
            <g key={side}>
              <rect x={side ? L - boxD : 0} y={(W - boxW) / 2} width={boxD} height={boxW} />
              {sixD > 0 && <rect x={side ? L - sixD : 0} y={(W - sixW) / 2} width={sixD} height={sixW} />}
              <line x1={gx} y1={(W - goalW) / 2} x2={gx} y2={(W + goalW) / 2} stroke={light ? '#64748b' : '#fff'}
                strokeWidth={sw * 4} />
              <circle cx={gx + dir * spot} cy={W / 2} r={sw * 1.5} fill={line} />
            </g>
          )
        })}
      </g>
      {children}
    </svg>
  )
}

export const HEAT_COLS = 12
export const HEAT_ROWS = 8

/** 12×8 체류 시간 격자를 경기장 위에 칠한다 */
export function HeatLayer({ heat, length, width, color = '#f97316' }:
  { heat: number[]; length: number; width: number; color?: string }) {
  const max = Math.max(...heat, 1e-6)
  const cw = length / HEAT_COLS
  const ch = width / HEAT_ROWS
  return (
    <g>
      {heat.map((v, i) => {
        if (v <= 0) return null
        const r = Math.floor(i / HEAT_COLS)
        const c = i % HEAT_COLS
        return <rect key={i} x={c * cw} y={r * ch} width={cw} height={ch} fill={color}
          fillOpacity={0.12 + 0.75 * (v / max)} />
      })}
    </g>
  )
}

export function Arrow({ x1, y1, x2, y2, color, width = 0.5, dashed }:
  { x1: number; y1: number; x2: number; y2: number; color: string; width?: number; dashed?: boolean }) {
  const dx = x2 - x1, dy = y2 - y1
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len, uy = dy / len
  const head = Math.min(2.2, len * 0.35)
  const hx = x2 - ux * head, hy = y2 - uy * head
  return (
    <g>
      <line x1={x1} y1={y1} x2={hx} y2={hy} stroke={color} strokeWidth={width} strokeLinecap="round"
        strokeDasharray={dashed ? `${width * 2} ${width * 2}` : undefined} />
      <polygon fill={color}
        points={`${x2},${y2} ${hx - uy * head * 0.5},${hy + ux * head * 0.5} ${hx + uy * head * 0.5},${hy - ux * head * 0.5}`} />
    </g>
  )
}
