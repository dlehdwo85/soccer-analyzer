'use client'
import Link from 'next/link'
import { ChevronRight, Film } from 'lucide-react'
import { Match } from '@/lib/types'
import StatusBadge from '@/components/ui/StatusBadge'
import Badge from '@/components/ui/Badge'
import { fmtDate, inkOn, SOURCE_LABEL } from '@/lib/utils'

export default function MatchCard({ match }: { match: Match }) {
  const hasResult = match.analysis_version === 2 && match.status !== 'analyzing'
  const href = hasResult ? `/matches/${match.id}/results` : `/matches/${match.id}`
  const stale = !!match.video_url && (match.analysis_version !== 2 || match.data_source !== 'video') && match.status !== 'analyzing'
  return (
    <Link href={href} className="card-hover p-4 flex flex-col gap-3 group">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-ink-400 num">{match.date || fmtDate(match.created_at)}</span>
        <div className="flex items-center gap-1.5">
          {stale && <Badge className="bg-sky-500/10 text-sky-300 border-sky-500/30"><Film className="w-3 h-3" />새 엔진 분석 가능</Badge>}
          <StatusBadge status={match.status} />
        </div>
      </div>
      <p className="font-extrabold text-lg text-ink-100 leading-snug line-clamp-2 group-hover:text-volt transition-colors">{match.title}</p>
      <div className="flex items-center gap-2 text-sm">
        <TeamDot color={match.home_team_color} name={match.home_team_name} />
        <span className="text-ink-600 text-xs font-bold">VS</span>
        <TeamDot color={match.away_team_color} name={match.away_team_name} />
      </div>
      {match.status === 'analyzing' ? (
        <div>
          <div className="flex justify-between text-[11px] text-ink-400 mb-1"><span>{match.analysis_message || '분석 중'}</span><span className="num">{Math.round(match.analysis_progress)}%</span></div>
          <div className="h-1.5 bg-ink-800 rounded-full overflow-hidden">
            <div className="h-full bg-volt rounded-full" style={{ width: `${match.analysis_progress}%` }} />
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between text-xs text-ink-500 mt-auto">
          <span>{hasResult ? `${SOURCE_LABEL[match.data_source ?? ''] ?? ''} 분석 결과 보기` : match.video_url ? '영상 분석 준비됨' : '영상을 올려 주세요'}</span>
          <ChevronRight className="w-4 h-4 group-hover:text-volt" />
        </div>
      )}
    </Link>
  )
}

function TeamDot({ color, name }: { color: string; name: string }) {
  return (
    <span className="flex items-center gap-1.5 min-w-0">
      <span className="w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-black shrink-0 ring-1 ring-white/15"
        style={{ background: color, color: inkOn(color) }}>{name.slice(0, 1)}</span>
      <span className="truncate text-ink-200 font-semibold">{name}</span>
    </span>
  )
}
