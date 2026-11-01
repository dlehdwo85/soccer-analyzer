import { PlayerStats } from '@/lib/types'

export const ZONES = [
  { key: 'walk_m', label: '걷기', range: '~7 km/h', color: '#cbd5e1' },
  { key: 'jog_m', label: '조깅', range: '7~14', color: '#86efac' },
  { key: 'run_m', label: '달리기', range: '14~20', color: '#facc15' },
  { key: 'sprint_m', label: '스프린트', range: '20+', color: '#ef4444' },
] as const

export default function SpeedZones({ stats, compact }: { stats: PlayerStats; compact?: boolean }) {
  const total = ZONES.reduce((a, z) => a + stats[z.key], 0)
  return (
    <div>
      <div className="flex h-3 rounded-full overflow-hidden bg-gray-100">
        {total > 0 && ZONES.map(z => (
          <div key={z.key} style={{ width: `${(stats[z.key] / total) * 100}%`, background: z.color }}
            title={`${z.label} ${Math.round(stats[z.key])}m`} />
        ))}
      </div>
      {!compact && (
        <div className="grid grid-cols-4 gap-1 mt-2">
          {ZONES.map(z => (
            <div key={z.key} className="text-[11px]">
              <div className="flex items-center gap-1 text-gray-500">
                <span className="w-2 h-2 rounded-sm" style={{ background: z.color }} />{z.label}
              </div>
              <p className="font-semibold text-gray-800 tabular-nums">{Math.round(stats[z.key])}m</p>
              <p className="text-gray-400">{z.range}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
