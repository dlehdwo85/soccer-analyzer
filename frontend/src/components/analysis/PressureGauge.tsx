'use client'

interface Props {
  homePress: number
  awayPress: number
  homeColor: string
  awayColor: string
  homeName: string
  awayName: string
}

export default function PressureGauge({ homePress, awayPress, homeColor, awayColor, homeName, awayName }: Props) {
  const total = homePress + awayPress || 1
  const homeW = Math.round((homePress / total) * 100)
  const awayW = 100 - homeW

  const level = (pct: number) => pct > 60 ? '강' : pct > 40 ? '중' : '약'
  const levelColor = (pct: number) => pct > 60 ? 'text-red-600' : pct > 40 ? 'text-yellow-600' : 'text-green-600'

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-sm font-medium">
        <div className="text-center">
          <p style={{ color: homeColor }}>{homeName}</p>
          <p className={`text-lg font-bold ${levelColor(homePress)}`}>{level(homePress)}</p>
          <p className="text-xs text-gray-500">{homePress.toFixed(1)}%</p>
        </div>
        <div className="flex-1 mx-4">
          <div className="h-4 rounded-full overflow-hidden flex">
            <div className="h-full transition-all duration-700" style={{ width: `${homeW}%`, background: homeColor }} />
            <div className="h-full transition-all duration-700" style={{ width: `${awayW}%`, background: awayColor }} />
          </div>
          <p className="text-[10px] text-center text-gray-400 mt-1">압박 강도 비율</p>
        </div>
        <div className="text-center">
          <p style={{ color: awayColor }}>{awayName}</p>
          <p className={`text-lg font-bold ${levelColor(awayPress)}`}>{level(awayPress)}</p>
          <p className="text-xs text-gray-500">{awayPress.toFixed(1)}%</p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <div className="bg-green-50 rounded-lg p-2">
          <p className="text-green-700 font-semibold">약 (0~40%)</p>
          <p className="text-gray-500">느슨한 수비</p>
        </div>
        <div className="bg-yellow-50 rounded-lg p-2">
          <p className="text-yellow-700 font-semibold">중 (40~60%)</p>
          <p className="text-gray-500">조직적 수비</p>
        </div>
        <div className="bg-red-50 rounded-lg p-2">
          <p className="text-red-700 font-semibold">강 (60%+)</p>
          <p className="text-gray-500">적극적 압박</p>
        </div>
      </div>
    </div>
  )
}
