'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

export function Logo() {
  return (
    <svg viewBox="0 0 32 32" className="w-6 h-6" aria-hidden>
      <rect x="2" y="7" width="28" height="18" rx="1.5" fill="none" stroke="#3fa35b" strokeWidth="2" />
      <line x1="16" y1="7" x2="16" y2="25" stroke="#3fa35b" strokeWidth="2" />
      <circle cx="16" cy="16" r="3.5" fill="none" stroke="#3fa35b" strokeWidth="2" />
    </svg>
  )
}

const LINKS = [
  { href: '/', label: '경기', match: (p: string) => p === '/' || p.startsWith('/matches/') && !p.startsWith('/matches/new') },
  { href: '/videos', label: '영상', match: (p: string) => p.startsWith('/videos') },
  { href: '/teams', label: '팀', match: (p: string) => p.startsWith('/teams') },
  { href: '/players', label: '선수', match: (p: string) => p.startsWith('/players') },
]

export default function Navbar() {
  const path = usePathname()
  return (
    <header className="sticky top-0 z-50 bg-ink-950 border-b border-ink-800">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-2 sm:gap-4">
        <Link href="/" className="flex items-center gap-2 font-semibold text-ink-100 whitespace-nowrap">
          <Logo />
          <span className="hidden sm:inline">풋볼 애널라이저</span>
        </Link>
        <nav className="flex items-center gap-1 flex-1 h-full" aria-label="주요 메뉴">
          {LINKS.map(({ href, label, match }) => {
            const on = match(path)
            return (
              <Link key={href} href={href} aria-current={on ? 'page' : undefined}
                className={cn('h-full flex items-center px-2 sm:px-3 text-sm whitespace-nowrap border-b-2 transition-colors',
                  on ? 'border-volt text-ink-100 font-medium' : 'border-transparent text-ink-400 hover:text-ink-100')}>
                {label}
              </Link>
            )
          })}
        </nav>
        <Link href="/matches/new" className="btn-secondary !px-3 !py-1.5 whitespace-nowrap">
          <span className="sm:hidden">새 경기</span><span className="hidden sm:inline">새 경기 등록</span>
        </Link>
      </div>
    </header>
  )
}
