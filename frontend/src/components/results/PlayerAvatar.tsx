'use client'
import { useState } from 'react'
import { api } from '@/lib/api'
import { Match, PlayerRow } from '@/lib/types'
import { inkOn, teamInfo } from '@/lib/utils'

/** 영상에서 잘라낸 선수 썸네일. 없으면 팀 색 원 + 등번호 */
export default function PlayerAvatar({ matchId, match, player, size = 32 }:
  { matchId: number; match: Match; player: PlayerRow; size?: number }) {
  const [broken, setBroken] = useState(false)
  const ring = teamInfo(match, player.team).color
  const color = player.color_hex || ring
  if (player.has_thumbnail && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={api.thumbnailUrl(matchId, player.track_id)} alt="" onError={() => setBroken(true)}
        className="rounded-xl object-cover object-top bg-ink-800 shrink-0"
        style={{ width: size, height: size, boxShadow: `0 0 0 2px ${ring}` }} />
    )
  }
  return (
    <span className="rounded-xl flex items-center justify-center font-extrabold shrink-0"
      style={{ width: size, height: size, background: color, color: inkOn(color), fontSize: size * 0.38,
               boxShadow: '0 0 0 1px rgba(255,255,255,.15) inset' }}>
      {player.jersey_number ?? (player.label.endsWith('_gk') ? 'GK' : '')}
    </span>
  )
}
