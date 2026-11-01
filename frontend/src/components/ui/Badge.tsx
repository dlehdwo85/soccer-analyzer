import { cn } from '@/lib/utils'

interface Props {
  children: React.ReactNode
  className?: string
}

export default function Badge({ children, className }: Props) {
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold border whitespace-nowrap', className)}>
      {children}
    </span>
  )
}
