'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Film, LayoutGrid, Plus, Users } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Logo() {
  return (
    <svg viewBox="0 0 32 32" className="w-7 h-7" aria-hidden>
      <rect width="32" height="32" rx="9" fill="#c8f031" />
      <rect x="6" y="9" width="20" height="14" rx="2" fill="none" stroke="#070b14" strokeWidth="2" />
      <line x1="16" y1="9" x2="16" y2="23" stroke="#070b14" strokeWidth="2" />
      <circle cx="16" cy="16" r="3" fill="#070b14" />
    </svg>
  )
}

const LINKS = [
  { href: '/', label: '경기', icon: LayoutGrid, match: (p: string) => p === '/' || p.startsWith('/matches/') && !p.startsWith('/matches/new') },
  { href: '/videos', label: '영상 보관함', icon: Film, match: (p: string) => p.startsWith('/videos') },
  { href: '/players', label: '선수', icon: Users, match: (p: string) => p.startsWith('/players') },
]

export default function Navbar() {
  const path = usePathname()
  return (
    <header className="sticky top-0 z-50 bg-ink-950/85 backdrop-blur border-b border-ink-800">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-3">
        <Link href="/" className="flex items-center gap-2 font-extrabold tracking-tight text-ink-100 whitespace-nowrap mr-2">
          <Logo />
          <span className="hidden sm:inline">풋볼 애널라이저</span>
        </Link>
        <nav className="flex items-center gap-1 flex-1">
          {LINKS.map(({ href, label, icon: Icon, match }) => (
            <Link key={href} href={href} aria-label={label}
              className={cn('flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors',
                match(path) ? 'bg-ink-800 text-ink-100' : 'text-ink-400 hover:text-ink-100')}>
              <Icon className="w-4 h-4" /><span className="hidden min-[440px]:inline">{label}</span>
            </Link>
          ))}
        </nav>
        <Link href="/matches/new" className="btn-primary !px-3 !py-1.5">
          <Plus className="w-4 h-4" /><span className="hidden sm:inline">새 경기</span>
        </Link>
      </div>
    </header>
  )
}
