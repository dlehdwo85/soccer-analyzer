'use client'
import { useState } from 'react'
import { api } from '@/lib/api'
import { Match, PlayerRow } from '@/lib/types'
import { inkOn, teamInfo } from '@/lib/utils'

/** 영상에서 잘라낸 선수 썸네일. 없으면 팀 색 원 + 등번호 */
export default function PlayerAvatar({ matchId, match, player, size = 32 }:
  { matchId: number; match: Match; player: PlayerRow; size?: number }) {
  const [broken, setBroken] = useState(false)
  const color = player.color_hex || teamInfo(match, player.team).color
  const ring = teamInfo(match, player.team).color
  if (player.has_thumbnail && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={api.thumbnailUrl(matchId, player.track_id)} alt="" onError={() => setBroken(true)}
        className="rounded-lg object-cover object-top bg-gray-100 shrink-0"
        style={{ width: size, height: size, boxShadow: `0 0 0 2px ${ring}` }} />
    )
  }
  return (
    <span className="rounded-full flex items-center justify-center font-bold shrink-0 border border-black/10"
      style={{ width: size, height: size, background: color, color: inkOn(color), fontSize: size * 0.38 }}>
      {player.jersey_number ?? (player.label.endsWith('_gk') ? 'GK' : '')}
    </span>
  )
}
