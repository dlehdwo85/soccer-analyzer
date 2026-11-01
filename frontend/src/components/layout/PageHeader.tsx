import { ReactNode } from 'react'

interface Props {
  title: string
  subtitle?: ReactNode
  eyebrow?: string
  actions?: ReactNode
}

export default function PageHeader({ title, subtitle, eyebrow, actions }: Props) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
      <div className="min-w-0">
        {eyebrow && <p className="label !text-volt mb-1">{eyebrow}</p>}
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-ink-100">{title}</h1>
        {subtitle && <p className="text-sm text-ink-400 mt-1.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}
