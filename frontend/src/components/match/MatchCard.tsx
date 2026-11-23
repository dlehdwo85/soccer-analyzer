'use client'
import Link from 'next/link'
import { Match } from '@/lib/types'
import { cn, fmtDateShort, isDark, SOURCE_LABEL, STATUS_LABEL } from '@/lib/utils'

/** 경기 목록의 카드 한 장 — 유튜브 목록처럼 큰 썸네일(두 팀 색) 아래 제목과 정보 한 줄 */
export default function MatchCard({ match }: { match: Match }) {
  const hasResult = match.analysis_version === 2 && match.status !== 'analyzing'
  const href = hasResult ? `/matches/${match.id}/results` : `/matches/${match.id}`
  const stale = !!match.video_url && (match.analysis_version !== 2 || match.data_source !== 'video') && match.status !== 'analyzing'
  const analyzing = match.status === 'analyzing'
  const date = fmtDateShort(match.date) || fmtDateShort(match.created_at)
  const facts = [
    date,
    match.field_type === 'soccer' ? '축구' : '풋살',
    hasResult ? `${SOURCE_LABEL[match.data_source ?? ''] ?? ''} 분석` : match.video_url ? '분석 전' : '영상 없음',
  ].filter(Boolean)
  const badge = analyzing ? `분석 중 ${Math.round(match.analysis_progress)}%` : hasResult ? '기록' : STATUS_LABEL[match.status]

  return (
    <Link href={href} className="group block -mx-4 sm:mx-0">
      <div className="relative aspect-video overflow-hidden sm:rounded-xl bg-ink-900"
        style={{ background: `linear-gradient(115deg, ${match.home_team_color} 0 49.6%, #070b14 49.6% 50.4%, ${match.away_team_color} 50.4% 100%)` }}>
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/25 to-black/10 group-hover:from-black/60 transition-colors" />
        <div className="absolute inset-0 flex items-center justify-center gap-3 px-4 text-white">
          <TeamName name={match.home_team_name} color={match.home_team_color} />
          <span className="text-sm font-semibold text-white/80 shrink-0">VS</span>
          <TeamName name={match.away_team_name} color={match.away_team_color} />
        </div>
        <span className={cn('absolute right-2 bottom-2 rounded px-1.5 py-0.5 text-xs font-semibold num',
          analyzing ? 'bg-volt text-ink-950' : 'bg-black/80 text-white')}>{badge}</span>
        {analyzing && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-white/20" role="progressbar" aria-valuemin={0} aria-valuemax={100}
            aria-valuenow={Math.round(match.analysis_progress)}>
            <div className="h-full bg-volt" style={{ width: `${match.analysis_progress}%` }} />
          </div>
        )}
      </div>
      <div className="flex gap-3 px-4 sm:px-0 pt-3 pb-5 sm:pb-2">
        <span className={cn('mt-0.5 w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-sm font-bold',
          isDark(match.home_team_color) ? 'text-white ring-1 ring-white/25' : 'text-ink-950')}
          style={{ background: match.home_team_color }} aria-hidden>
          {match.home_team_name.slice(0, 1)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink-100 leading-snug line-clamp-2">{match.title}</p>
          <p className="text-xs text-ink-400 mt-1 num truncate">{facts.join(' · ')}</p>
          {analyzing && match.analysis_message && <p className="text-xs text-ink-500 mt-0.5 truncate">{match.analysis_message}</p>}
          {stale && <p className="text-xs text-volt mt-0.5">새 엔진으로 다시 분석 가능</p>}
        </div>
      </div>
    </Link>
  )
}

function TeamName({ name, color }: { name: string; color: string }) {
  return (
    <span className="min-w-0 flex-1 basis-0 text-center">
      <span className={cn('inline-block max-w-full truncate rounded-md px-2.5 py-1 text-lg sm:text-xl font-bold',
        isDark(color) ? 'bg-black/35' : 'bg-black/45')}>{name}</span>
    </span>
  )
}
