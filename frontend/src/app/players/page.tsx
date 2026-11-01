'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ChevronRight, Users } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { PlayerProfile } from '@/lib/types'
import PageHeader from '@/components/layout/PageHeader'

export default function PlayersPage() {
  const [profiles, setProfiles] = useState<PlayerProfile[] | null>(null)

  useEffect(() => {
    api.getPlayerProfiles().then(setProfiles).catch(() => { toast.error('선수 목록을 불러올 수 없습니다'); setProfiles([]) })
  }, [])

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <PageHeader eyebrow="선수" title="선수 누적 기록" subtitle="경기 결과의 '선수 정리'에서 이름을 붙인 선수의 여러 경기 기록을 합칩니다" />
      {profiles === null ? (
        <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="card h-20 animate-pulse" />)}</div>
      ) : profiles.length === 0 ? (
        <div className="card p-12 text-center">
          <Users className="w-10 h-10 text-ink-600 mx-auto mb-3" />
          <p className="text-ink-200 font-bold mb-1">아직 이름이 붙은 선수가 없습니다</p>
          <p className="text-sm text-ink-500 mb-5">분석 결과의 &lsquo;선수 정리&rsquo; 탭에서 트랙에 이름을 붙이면 여기서 기록이 합산됩니다.</p>
          <Link href="/" className="btn-primary">경기 목록으로</Link>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {profiles.map(p => {
            const t = p.totals
            return (
              <Link key={p.name} href={`/players/${encodeURIComponent(p.name)}`} className="card-hover p-4 flex items-center gap-4 group">
                <div className="w-12 h-12 rounded-lg bg-volt flex items-center justify-center shrink-0">
                  <span className="text-ink-950 font-semibold text-lg">{p.jersey_number ?? p.name.slice(0, 1)}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-ink-100 group-hover:text-volt">{p.name}</p>
                  <p className="text-xs text-ink-500">{p.match_count}경기 · {Math.round(t.minutes)}분</p>
                  <div className="flex gap-3 mt-1.5 text-[11px] text-ink-400 num">
                    <span>패스 <b className="text-ink-100">{t.pass_accuracy !== null ? `${t.pass_accuracy.toFixed(0)}%` : '-'}</b></span>
                    <span>키패스 <b className="text-ink-100">{t.key_passes}</b></span>
                    <span>슈팅 <b className="text-ink-100">{t.shots}/{t.shots_on_target}</b></span>
                    <span>수비 <b className="text-ink-100">{t.interceptions + t.recoveries}</b></span>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-ink-600 group-hover:text-volt" />
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
