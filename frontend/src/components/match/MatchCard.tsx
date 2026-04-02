'use client'
import Link from 'next/link'
import { Calendar, ChevronRight } from 'lucide-react'
import { Match } from '@/lib/types'
import StatusBadge from '@/components/ui/StatusBadge'
import { fmtDate } from '@/lib/utils'

export default function MatchCard({ match }: { match: Match }) {
  return (
    <Link href={`/matches/${match.id}`} className="card p-4 flex items-center gap-4 hover:border-green-300 hover:shadow-sm transition-all group">
      {/* 팀 색상 */}
      <div className="flex flex-col gap-1 shrink-0">
        <div className="w-3 h-3 rounded-full border border-gray-200" style={{ background: match.home_team_color }} />
        <div className="w-3 h-3 rounded-full border border-gray-200" style={{ background: match.away_team_color }} />
      </div>

      {/* 정보 */}
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-gray-900 truncate group-hover:text-green-700">{match.title}</p>
        <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <Calendar className="w-3 h-3" />{fmtDate(match.created_at)}
          </span>
          <span>{match.home_team_name} vs {match.away_team_name}</span>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <StatusBadge status={match.status} />
        <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-green-600" />
      </div>
    </Link>
  )
}
