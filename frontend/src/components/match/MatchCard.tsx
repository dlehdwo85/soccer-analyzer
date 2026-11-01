'use client'
import Link from 'next/link'
import { Calendar, ChevronRight } from 'lucide-react'
import { Match } from '@/lib/types'
import StatusBadge from '@/components/ui/StatusBadge'
import { fmtDate, SOURCE_LABEL } from '@/lib/utils'

export default function MatchCard({ match }: { match: Match }) {
  const href = match.analysis_version === 2 && match.status !== 'analyzing'
    ? `/matches/${match.id}/results` : `/matches/${match.id}`
  return (
    <Link href={href} className="card p-4 flex items-center gap-4 hover:border-green-300 hover:shadow-sm transition-all group">
      <div className="flex -space-x-1.5 shrink-0">
        <span className="w-6 h-6 rounded-full border-2 border-white shadow" style={{ background: match.home_team_color }} />
        <span className="w-6 h-6 rounded-full border-2 border-white shadow" style={{ background: match.away_team_color }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-gray-900 truncate group-hover:text-green-700">{match.title}</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-xs text-gray-500">
          <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{match.date || fmtDate(match.created_at)}</span>
          <span className="truncate">{match.home_team_name} vs {match.away_team_name}</span>
          {match.analysis_version === 2 && match.data_source && <span>{SOURCE_LABEL[match.data_source]} 분석</span>}
        </div>
        {match.status === 'analyzing' && (
          <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-yellow-400 rounded-full" style={{ width: `${match.analysis_progress}%` }} />
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <StatusBadge status={match.status} />
        <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-green-600" />
      </div>
    </Link>
  )
}
