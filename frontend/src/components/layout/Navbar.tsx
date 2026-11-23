'use client'
import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Clapperboard, Home, Plus, Shirt, Users } from 'lucide-react'
import { API_BASE } from '@/lib/api'
import { loginUrl, logout, useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'

/** 팬텀 로고 — 팬텀 드리블의 잔상: 공 뒤에 초록 잔상 두 개가 따라온다 (app/icon.svg와 같은 그림) */
export function Logo({ className = 'w-7 h-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <rect width="64" height="64" rx="14" fill="#0d1321" />
      <path d="M7 51 C 17 51, 23 46, 27 41" fill="none" stroke="#3fa35b" strokeWidth="3" strokeLinecap="round" opacity="0.55" />
      <circle cx="19" cy="39" r="8.5" fill="#3fa35b" opacity="0.2" />
      <circle cx="28.5" cy="33.5" r="10" fill="#3fa35b" opacity="0.42" />
      <circle cx="40" cy="27" r="12.5" fill="#eef2fa" />
      <g stroke="#0d1321" strokeWidth="1.6" strokeLinecap="round" fill="none">
        <line x1="40" y1="22.5" x2="40" y2="14.5" />
        <line x1="44.3" y1="25.6" x2="51.9" y2="23.1" />
        <line x1="42.6" y1="30.6" x2="47.3" y2="37.1" />
        <line x1="37.4" y1="30.6" x2="32.7" y2="37.1" />
        <line x1="35.7" y1="25.6" x2="28.1" y2="23.1" />
      </g>
      <polygon points="40,22.5 44.3,25.6 42.6,30.6 37.4,30.6 35.7,25.6" fill="#0d1321" />
    </svg>
  )
}

const LINKS = [
  { href: '/', label: '경기', icon: Home, match: (p: string) => p === '/' || p.startsWith('/matches/') && !p.startsWith('/matches/new') },
  { href: '/videos', label: '영상', icon: Clapperboard, match: (p: string) => p.startsWith('/videos') },
  { href: '/teams', label: '팀', icon: Users, match: (p: string) => p.startsWith('/teams') },
  { href: '/players', label: '선수', icon: Shirt, match: (p: string) => p.startsWith('/players') },
]

export default function Navbar() {
  const path = usePathname()
  return (
    <header className="app-bar sticky top-0 z-50 bg-ink-950 sm:border-b border-ink-800">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-2 sm:gap-4">
        <Link href="/" className="flex items-center gap-2 font-semibold text-ink-100 whitespace-nowrap">
          <Logo />
          <span className="tracking-tight text-lg sm:text-base">팬텀</span>
        </Link>
        {/* 휴대폰에서는 메뉴가 아래 막대(MobileTabBar)로 내려간다 */}
        <span className="flex-1 sm:hidden" aria-hidden />
        <nav className="hidden sm:flex items-center gap-1 flex-1 h-full" aria-label="주요 메뉴">
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
        <Link href="/matches/new" className="hidden sm:inline-flex btn-secondary !px-3 !py-1.5 whitespace-nowrap">새 경기 등록</Link>
        <Account />
      </div>
    </header>
  )
}

/** 휴대폰 아래 메뉴 막대 — 유튜브 앱처럼 아이콘 + 짧은 이름, 가운데는 새 경기 등록 */
export function MobileTabBar() {
  const path = usePathname()
  const item = ({ href, label, icon: Icon, match }: typeof LINKS[number]) => {
    const on = match(path)
    return (
      <Link key={href} href={href} aria-current={on ? 'page' : undefined}
        className={cn('flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] h-full',
          on ? 'text-ink-100 font-semibold' : 'text-ink-400')}>
        <Icon className="w-6 h-6" strokeWidth={on ? 2.4 : 1.6} />
        {label}
      </Link>
    )
  }
  return (
    <nav aria-label="주요 메뉴"
      className="app-tabbar sm:hidden fixed inset-x-0 bottom-0 z-40 bg-ink-950/95 backdrop-blur border-t border-ink-800"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="h-14 flex items-stretch">
        {LINKS.slice(0, 2).map(item)}
        <Link href="/matches/new" aria-label="새 경기 등록" className="flex-1 flex items-center justify-center">
          <span className={cn('w-10 h-10 rounded-full flex items-center justify-center border',
            path.startsWith('/matches/new') ? 'bg-ink-100 text-ink-950 border-ink-100' : 'border-ink-500 text-ink-100')}>
            <Plus className="w-6 h-6" strokeWidth={1.8} />
          </span>
        </Link>
        {LINKS.slice(2).map(item)}
      </div>
    </nav>
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
