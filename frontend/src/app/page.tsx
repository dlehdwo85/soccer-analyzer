'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { PlusCircle, RefreshCw, Zap } from 'lucide-react'
import { Match } from '@/lib/types'
import { api } from '@/lib/api'
import MatchCard from '@/components/match/MatchCard'
import PageHeader from '@/components/layout/PageHeader'
import { toast } from 'sonner'

export default function HomePage() {
  const [matches, setMatches] = useState<Match[]>([])
  const [loading, setLoading] = useState(true)
  const [backendOk, setBackendOk] = useState<boolean | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      await api.health()
      setBackendOk(true)
      const data = await api.getMatches()
      setMatches(data)
    } catch {
      setBackendOk(false)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <PageHeader
        title="경기 목록"
        subtitle="분석된 경기를 확인하고 새 경기를 등록하세요"
        actions={
          <div className="flex gap-2">
            <button onClick={load} className="btn-secondary">
              <RefreshCw className="w-4 h-4" />새로고침
            </button>
            <Link href="/matches/new" className="btn-primary">
              <PlusCircle className="w-4 h-4" />새 경기 등록
            </Link>
          </div>
        }
      />

      {/* 백엔드 상태 */}
      {backendOk === false && (
        <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-xl flex items-start gap-3">
          <span className="text-yellow-500 text-lg">⚠️</span>
          <div>
            <p className="font-semibold text-yellow-800 text-sm">백엔드 서버에 연결할 수 없습니다</p>
            <p className="text-yellow-700 text-xs mt-1">
              <code className="bg-yellow-100 px-1 rounded">cd backend && uvicorn main:app --reload</code> 명령으로 서버를 먼저 실행해주세요.
            </p>
          </div>
        </div>
      )}

      {/* 로딩 */}
      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="card p-4 h-16 animate-pulse bg-gray-100" />
          ))}
        </div>
      )}

      {/* 경기 없음 */}
      {!loading && matches.length === 0 && (
        <div className="text-center py-20">
          <div className="w-20 h-20 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <Zap className="w-8 h-8 text-green-600" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">아직 등록된 경기가 없습니다</h2>
          <p className="text-gray-500 mb-6">샘플 경기를 불러오거나 새 경기를 직접 등록해보세요.</p>
          <Link href="/matches/new" className="btn-primary inline-flex">
            <PlusCircle className="w-4 h-4" />첫 경기 등록하기
          </Link>
        </div>
      )}

      {/* 경기 목록 */}
      {!loading && matches.length > 0 && (
        <div className="space-y-3">
          {matches.map(m => <MatchCard key={m.id} match={m} />)}
        </div>
      )}
    </div>
  )
}
