'use client'
import Link from 'next/link'
import { Match } from '@/lib/types'
import StatusBadge from '@/components/ui/StatusBadge'
import { cn, fmtDateShort, isDark, SOURCE_LABEL } from '@/lib/utils'

/** 경기 목록의 한 줄. 날짜 · 제목 · 양 팀 · 기록 상태를 기록표처럼 보여 준다. */
export default function MatchCard({ match }: { match: Match }) {
  const hasResult = match.analysis_version === 2 && match.status !== 'analyzing'
  const href = hasResult ? `/matches/${match.id}/results` : `/matches/${match.id}`
  const stale = !!match.video_url && (match.analysis_version !== 2 || match.data_source !== 'video') && match.status !== 'analyzing'
  const analyzing = match.status === 'analyzing'
  const date = fmtDateShort(match.date) || fmtDateShort(match.created_at)
  const facts = [
    match.field_type === 'soccer' ? '축구' : '풋살',
    hasResult ? `${SOURCE_LABEL[match.data_source ?? ''] ?? ''} 분석` : match.video_url ? '영상 있음 · 분석 전' : '영상 없음',
    stale ? '새 엔진으로 다시 분석 가능' : null,
  ].filter(Boolean)

  return (
    <Link href={href} className="flex gap-4 px-4 py-3 hover:bg-ink-850 transition-colors">
      <span className="hidden sm:block w-[5.5rem] shrink-0 num text-xs text-ink-400 pt-0.5">{date}</span>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-ink-100 truncate">{match.title}</p>
        <p className="mt-0.5 flex items-center gap-2 text-sm text-ink-200 min-w-0">
          <TeamMark color={match.home_team_color} name={match.home_team_name} />
          <span className="text-xs text-ink-500 shrink-0">vs</span>
          <TeamMark color={match.away_team_color} name={match.away_team_name} />
        </p>
        <p className="text-xs text-ink-500 mt-1 num truncate">
          <span className="sm:hidden">{date} · </span>{facts.join(' · ')}
        </p>
        {analyzing && (
          <div className="mt-2 max-w-xs">
            <div className="flex justify-between text-[11px] text-ink-400 mb-1">
              <span className="truncate">{match.analysis_message || '분석 중'}</span>
              <span className="num ml-2">{Math.round(match.analysis_progress)}%</span>
            </div>
            <div className="h-1 bg-ink-800 rounded-sm overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(match.analysis_progress)}>
              <div className="h-full bg-volt" style={{ width: `${match.analysis_progress}%` }} />
            </div>
          </div>
        )}
      </div>
      <div className="shrink-0 flex flex-col items-end gap-1 pt-0.5">
        <StatusBadge status={match.status} />
        {hasResult && <span className="text-[11px] text-ink-500">기록 보기</span>}
      </div>
    </Link>
  )
}

function TeamMark({ color, name }: { color: string; name: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      <span className={cn('w-2.5 h-2.5 rounded-sm shrink-0', isDark(color) && 'ring-1 ring-white/25')} style={{ background: color }} aria-hidden />
      <span className="truncate">{name}</span>
    </span>
  )
}
