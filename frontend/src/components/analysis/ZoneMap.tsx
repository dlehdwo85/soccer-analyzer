'use client'

interface ZoneData {
  [zone: string]: number
}

interface Props {
  homeZone: ZoneData
  awayZone: ZoneData
  homeColor: string
  awayColor: string
}

const ZONES = [
  ['좌측 수비', '중앙 수비', '우측 수비'],
  ['좌측 미드', '중앙 미드', '우측 미드'],
  ['좌측 공격', '중앙 공격', '우측 공격'],
]

export default function ZoneMap({ homeZone, awayZone, homeColor, awayColor }: Props) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4 text-xs mb-2">
        <span className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full" style={{ background: homeColor }} />
          홈팀
        </span>
        <span className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full" style={{ background: awayColor }} />
          원정팀
        </span>
      </div>
      <div className="grid grid-cols-3 gap-1">
        {ZONES.flat().map(zone => {
          const hPct = homeZone[zone] ?? 0
          const aPct = awayZone[zone] ?? 0
          const total = hPct + aPct || 1
          const hWidth = Math.round((hPct / total) * 100)
          const aWidth = 100 - hWidth
          return (
            <div key={zone} className="bg-gray-50 rounded-lg p-2 border border-gray-100">
              <p className="text-[10px] text-gray-500 mb-1.5 font-medium">{zone}</p>
              <div className="h-2 rounded-full overflow-hidden flex">
                <div className="h-full rounded-l" style={{ width: `${hWidth}%`, background: homeColor }} />
                <div className="h-full rounded-r" style={{ width: `${aWidth}%`, background: awayColor }} />
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-[9px] font-mono" style={{ color: homeColor }}>{hPct.toFixed(1)}%</span>
                <span className="text-[9px] font-mono" style={{ color: awayColor }}>{aPct.toFixed(1)}%</span>
              </div>
            </div>
          )
        })}
      </div>
      <p className="text-[10px] text-gray-400 text-center">
        좌: 수비 진영 → 우: 공격 진영 기준
      </p>
    </div>
  )
}
