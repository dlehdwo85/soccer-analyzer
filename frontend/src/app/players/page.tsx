'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ChevronRight, Users } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { PlayerProfile } from '@/lib/types'
import { fmtDist } from '@/lib/utils'
import PageHeader from '@/components/layout/PageHeader'

export default function PlayersPage() {
  const [profiles, setProfiles] = useState<PlayerProfile[] | null>(null)

  useEffect(() => {
    api.getPlayerProfiles().then(setProfiles).catch(() => { toast.error('선수 목록을 불러올 수 없습니다'); setProfiles([]) })
  }, [])

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <PageHeader title="선수 프로필" subtitle="경기 결과의 '선수 정리'에서 이름을 붙인 선수의 누적 기록" />
      {profiles === null ? (
        <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="card h-20 animate-pulse bg-gray-100" />)}</div>
      ) : profiles.length === 0 ? (
        <div className="card p-10 text-center">
          <Users className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-600 font-medium mb-1">아직 이름이 붙은 선수가 없습니다</p>
          <p className="text-xs text-gray-400 mb-4">분석 결과 화면의 &lsquo;선수 정리&rsquo; 탭에서 트랙에 이름을 붙이면 여기서 경기별 기록이 합산됩니다.</p>
          <Link href="/" className="btn-primary inline-flex text-sm">경기 목록으로</Link>
        </div>
      ) : (
        <div className="space-y-2">
          {profiles.map(p => {
            const t = p.totals
            return (
              <Link key={p.name} href={`/players/${encodeURIComponent(p.name)}`}
                className="card flex items-center gap-4 p-4 hover:border-green-300 hover:shadow-sm transition-all group">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-green-500 to-green-700 flex items-center justify-center shrink-0">
                  <span className="text-white font-bold text-lg">{p.jersey_number ?? p.name.slice(0, 1)}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 group-hover:text-green-700">{p.name}</p>
                  <p className="text-xs text-gray-400">{p.match_count}경기 · {Math.round(t.minutes)}분</p>
                </div>
                <div className="hidden sm:grid grid-cols-4 gap-4 text-center text-xs">
                  <Mini label="패스 성공률" value={t.pass_accuracy !== null ? `${t.pass_accuracy.toFixed(0)}%` : '–'} />
                  <Mini label="슈팅/유효" value={`${t.shots}/${t.shots_on_target}`} />
                  <Mini label="가로채기+탈취" value={`${t.interceptions + t.recoveries}`} />
                  <Mini label="이동거리" value={fmtDist(t.distance_m)} />
                </div>
                <ChevronRight className="w-4 h-4 text-gray-400" />
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-bold text-gray-900 text-sm tabular-nums">{value}</p>
      <p className="text-gray-400">{label}</p>
    </div>
  )
}
