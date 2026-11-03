'use client'
import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { API_BASE } from '@/lib/api'
import { loginUrl, logout, useAuth } from '@/lib/auth'
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
        <Account />
      </div>
    </header>
  )
}


/** 카카오 로그인 (서버에 카카오 키가 설정돼 있을 때만 보인다) */
function Account() {
  const auth = useAuth(API_BASE)
  const [open, setOpen] = useState(false)
  if (!auth.enabled) return null
  if (!auth.user) {
    return (
      <a href={loginUrl(API_BASE)} className="btn !px-3 !py-1.5 bg-[#FEE500] text-[#191919] hover:bg-[#f5dc00] whitespace-nowrap text-sm font-semibold">
        로그인
      </a>
    )
  }
  const u = auth.user
  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)} aria-label="내 계정" aria-expanded={open}
        className="w-8 h-8 rounded-full overflow-hidden bg-ink-700 flex items-center justify-center text-xs text-ink-100 border border-ink-600">
        {u.profile_image ? <img src={u.profile_image} alt="" className="w-full h-full object-cover" /> : (u.nickname ?? '나').slice(0, 1)}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-56 card p-2 shadow-xl z-50" onMouseLeave={() => setOpen(false)}>
          <p className="px-2 py-1.5 text-sm text-ink-100 font-medium truncate">{u.nickname ?? '카카오 사용자'}</p>
          {u.teams.map(t => (
            <Link key={t.id} href={`/teams/${t.id}`} onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-2 py-1.5 rounded text-sm text-ink-300 hover:bg-ink-800">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: t.color }} />
              <span className="flex-1 truncate">{t.name}</span>
              <span className="text-[10px] text-ink-500">{t.role === 'owner' ? '팀장' : t.role === 'manager' ? '운영진' : '팀원'}</span>
            </Link>
          ))}
          <button onClick={() => { logout(); setOpen(false) }}
            className="w-full text-left px-2 py-1.5 rounded text-sm text-ink-400 hover:bg-ink-800 mt-1 border-t border-ink-800">로그아웃</button>
        </div>
      )}
    </div>
  )
}
