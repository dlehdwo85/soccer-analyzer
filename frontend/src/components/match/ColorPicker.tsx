'use client'

const PRESETS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#3b82f6', '#8b5cf6', '#ec4899', '#ffffff',
  '#000000', '#6b7280', '#dc2626', '#1d4ed8',
]

interface Props {
  label: string
  value: string
  onChange: (v: string) => void
}

export default function ColorPicker({ label, value, onChange }: Props) {
  return (
    <div>
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">{label}</p>
      <div className="flex flex-wrap gap-2 mb-2">
        {PRESETS.map(c => (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            className="w-8 h-8 rounded-full border-2 transition-transform hover:scale-110"
            style={{
              background: c,
              borderColor: value === c ? '#16a34a' : '#e5e7eb',
              transform: value === c ? 'scale(1.2)' : undefined,
            }}
          />
        ))}
        <input
          type="color"
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-8 h-8 rounded-full border-2 border-gray-200 cursor-pointer"
          title="직접 선택"
        />
      </div>
      <div className="flex items-center gap-2 text-sm text-gray-600">
        <div className="w-5 h-5 rounded-full border border-gray-300" style={{ background: value }} />
        <span>{value}</span>
      </div>
    </div>
  )
}
