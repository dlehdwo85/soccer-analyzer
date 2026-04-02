import { Match, MatchSummary, PlayerDetail, PlayerTrackSummary } from './types'

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? 'API error')
  }
  return res.json()
}

export const api = {
  getMatches: () => req<Match[]>('/api/matches'),
  getMatch: (id: number) => req<Match>(`/api/matches/${id}`),
  createMatch: (body: {
    title: string; date: string; field_type: string
    home_team_name: string; away_team_name: string
    home_team_color: string; away_team_color: string
    referee_color: string
  }) => req<Match>('/api/matches', { method: 'POST', body: JSON.stringify(body) }),
  uploadVideo: async (id: number, file: File): Promise<{ filename: string }> => {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(`${BASE}/api/matches/${id}/upload`, { method: 'POST', body: form })
    if (!res.ok) throw new Error('업로드 실패')
    return res.json()
  },
  analyze: (id: number, useSample = false) =>
    req<{ status: string; message: string }>(`/api/matches/${id}/analyze`, {
      method: 'POST', body: JSON.stringify({ use_sample: useSample }),
    }),
  getSummary: (id: number) => req<MatchSummary>(`/api/matches/${id}/summary`),
  getPlayers: (id: number) => req<PlayerTrackSummary[]>(`/api/matches/${id}/players`),
  getPlayerDetail: (matchId: number, trackId: string) =>
    req<PlayerDetail>(`/api/matches/${matchId}/players/${trackId}`),
  health: () => req<{ status: string }>('/api/health'),
}
