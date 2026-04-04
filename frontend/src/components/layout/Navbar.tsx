'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Activity, PlusCircle, Users } from 'lucide-react'

export default function Navbar() {
  const path = usePathname()
  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-bold text-lg text-green-700">
          <Activity className="w-5 h-5" />
          풋볼 애널라이저
        </Link>
        <nav className="flex items-center gap-3">
          <Link href="/" className={`text-sm font-medium transition-colors ${path === '/' ? 'text-green-700' : 'text-gray-600 hover:text-gray-900'}`}>
            경기 목록
          </Link>
          <Link href="/players" className={`flex items-center gap-1 text-sm font-medium transition-colors ${path.startsWith('/players') ? 'text-green-700' : 'text-gray-600 hover:text-gray-900'}`}>
            <Users className="w-4 h-4"/>선수 프로필
          </Link>
          <Link href="/matches/new" className="btn-primary text-sm">
            <PlusCircle className="w-4 h-4" />
            새 경기 등록
          </Link>
        </nav>
      </div>
    </header>
  )
}
