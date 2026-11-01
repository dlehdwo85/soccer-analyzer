'use client'

const PRESETS = [
  '#ffffff', '#111827', '#6b7280', '#dc2626', '#f97316', '#facc15',
  '#16a34a', '#38bdf8', '#2563eb', '#1e3a8a', '#7c3aed', '#ec4899',
]

interface Props {
  label: string
  value: string
  onChange: (v: string) => void
}

export default function ColorPicker({ label, value, onChange }: Props) {
  return (
    <div>
      {label && <p className="text-xs font-medium text-ink-400 uppercase tracking-wide mb-2">{label}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map(c => (
          <button key={c} type="button" onClick={() => onChange(c)} aria-label={c} aria-pressed={value === c}
            className="w-7 h-7 rounded-full border-2 transition-transform hover:scale-110"
            style={{
              background: c,
              borderColor: value === c ? '#c8f031' : '#34416a',
              transform: value === c ? 'scale(1.15)' : undefined,
            }} />
        ))}
        <label className="flex items-center gap-1.5 text-xs text-ink-400 cursor-pointer ml-1">
          <input type="color" value={value} onChange={e => onChange(e.target.value)}
            className="w-7 h-7 rounded border border-ink-700 cursor-pointer p-0" />
          {value}
        </label>
      </div>
    </div>
  )
}
