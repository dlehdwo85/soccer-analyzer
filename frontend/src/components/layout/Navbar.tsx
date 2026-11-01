'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Activity, List, PlusCircle, Users } from 'lucide-react'

export default function Navbar() {
  const path = usePathname()
  const link = (active: boolean) =>
    `flex items-center gap-1 text-sm font-medium whitespace-nowrap transition-colors ${active ? 'text-green-700' : 'text-gray-600 hover:text-gray-900'}`
  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-2 font-bold text-lg text-green-700 whitespace-nowrap">
          <Activity className="w-5 h-5" />
          <span className="hidden min-[400px]:inline">풋볼 애널라이저</span>
        </Link>
        <nav className="flex items-center gap-3 sm:gap-4">
          <Link href="/" className={link(path === '/')} aria-label="경기 목록">
            <List className="w-4 h-4 sm:hidden" /><span className="hidden sm:inline">경기 목록</span>
          </Link>
          <Link href="/players" className={link(path.startsWith('/players'))} aria-label="선수 프로필">
            <Users className="w-4 h-4" /><span className="hidden sm:inline">선수 프로필</span>
          </Link>
          <Link href="/matches/new" className="btn-primary text-sm whitespace-nowrap">
            <PlusCircle className="w-4 h-4" />새 경기<span className="hidden sm:inline"> 등록</span>
          </Link>
        </nav>
      </div>
    </header>
  )
}
