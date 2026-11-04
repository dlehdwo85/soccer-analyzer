import {
  AnalysisStatus, BillingConfig, Calibration, CalibrationInput, Club, ClubInput, EventCreate, EventPatch, Health, Match, MatchInput, MatchResult, MatchSummary,
  MatchAccess, Overlay, PlayerProfile, PlayerProfileDetail, PlayerReport, Season, Team, TeamMembers, TeamRole, VideoLibrary,
} from './types'

import { getToken } from './auth'

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

/** 서버가 오류 상태로 응답함 — message는 서버의 detail */
export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken()
  const auth: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: init?.body instanceof FormData ? { ...auth, ...init?.headers } : { 'Content-Type': 'application/json', ...auth, ...init?.headers },
  })
  if (!res.ok) {
    // 프리미엄 기능 — 결제 창을 띄운다 (PaywallHost가 받는다)
    const m402 = res.status === 402 ? path.match(/^\/api\/matches\/(\d+)/) : null
    if (m402 && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('paywall', { detail: Number(m402[1]) }))
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    const detail = Array.isArray(err.detail) ? err.detail.map((d: { msg: string }) => d.msg).join(', ') : err.detail
    throw new ApiError(detail || `요청 실패 (${res.status})`, res.status)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

const json = (method: string, body?: unknown): RequestInit => ({
  method, body: body === undefined ? undefined : JSON.stringify(body),
})

function uploadWithProgress(method: 'PUT' | 'POST', url: string, body: Blob | FormData,
                            onProgress?: (pct: number) => void, contentType?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.upload.addEventListener('progress', e => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100))
    })
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.responseText)
      else {
        let msg = `업로드 실패 (${xhr.status})`
        try { msg = JSON.parse(xhr.responseText).detail ?? msg } catch { /* 본문이 JSON이 아님 */ }
        reject(new Error(msg))
      }
    })
    xhr.addEventListener('error', () => reject(new Error('네트워크 오류')))
    xhr.open(method, url)
    if (contentType) xhr.setRequestHeader('Content-Type', contentType)
    xhr.send(body)
  })
}

export const api = {
  health: () => req<Health>('/api/health'),
  /** 무료 서버(Hugging Face Space)는 오래 안 쓰면 잠든다 — 깨어날 때까지 최대 maxSec초 기다린다 */
  waitForBackend: async (onWaiting?: (sec: number) => void, maxSec = 150): Promise<Health> => {
    const started = Date.now()
    for (;;) {
      try {
        return await req<Health>('/api/health')
      } catch (e) {
        const sec = Math.round((Date.now() - started) / 1000)
        if (sec >= maxSec) throw e
        onWaiting?.(sec)
        await new Promise(r => setTimeout(r, 5000))
      }
    }
  },

  // ── 경기 ───────────────────────────────────────────────────────
  getMatches: () => req<Match[]>('/api/matches'),
  getMatch: (id: number) => req<Match>(`/api/matches/${id}`),
  createMatch: (body: MatchInput) => req<Match>('/api/matches', json('POST', body)),
  updateMatch: (id: number, body: Partial<MatchInput>) => req<Match>(`/api/matches/${id}`, json('PATCH', body)),
  deleteMatch: (id: number) => req<void>(`/api/matches/${id}`, json('DELETE')),

  /** R2가 설정돼 있으면 브라우저 → R2 직접 업로드, 아니면 서버로 업로드 */
  uploadVideo: async (id: number, file: File, onProgress?: (pct: number) => void) => {
    const presign = await fetch(`${API_BASE}/api/matches/${id}/upload-url?filename=${encodeURIComponent(file.name)}`)
    if (presign.ok) {
      const { upload_url, public_url } = await presign.json()
      await uploadWithProgress('PUT', upload_url, file, onProgress, 'video/mp4')
      return req<{ video_url: string }>(`/api/matches/${id}/set-video-url`,
        json('POST', { video_url: public_url, filename: file.name }))
    }
    if (presign.status !== 404) {
      const err = await presign.json().catch(() => ({}))
      throw new Error(err.detail ?? '업로드 준비 실패')
    }
    const form = new FormData()
    form.append('file', file)
    return JSON.parse(await uploadWithProgress('POST', `${API_BASE}/api/matches/${id}/upload`, form, onProgress))
  },
  /** 브라우저 재생용 사본이 있으면 그것을, 없으면 원본 영상 */
  videoSrc: (m: Match) =>
    m.web_video_url && !m.web_video_url.startsWith('local:') ? m.web_video_url
      : !m.video_url ? null : m.video_url.startsWith('local:') ? `${API_BASE}/api/matches/${m.id}/video` : m.video_url,

  getCalibration: (id: number) => req<Calibration | null>(`/api/matches/${id}/calibration`),
  setCalibration: (id: number, body: CalibrationInput) => req<Match>(`/api/matches/${id}/calibration`, json('PUT', body)),
  clearCalibration: (id: number) => req<Match>(`/api/matches/${id}/calibration`, json('DELETE')),

  notifyConfig: () => req<{ alimtalk: boolean }>('/api/notify/config'),
  analyze: (id: number, body: { mode: 'video' | 'sample'; quality?: 'standard' | 'max'; start_seconds?: number; max_seconds?: number | null; notify_phone?: string }) =>
    req<{ status: string; mode: string }>(`/api/matches/${id}/analyze`, json('POST', body)),
  getStatus: (id: number) => req<AnalysisStatus>(`/api/matches/${id}/status`),
  getResult: (id: number, period?: 1 | 2 | null) =>
    req<MatchResult>(`/api/matches/${id}/result${period ? `?period=${period}` : ''}`),
  /** 영상 검수용 프레임별 선수 박스·공 위치. 이 분석에 데이터가 없으면(404) null */
  getOverlay: async (id: number): Promise<Overlay | null> => {
    const res = await fetch(`${API_BASE}/api/matches/${id}/overlay`)
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`영상 검수 데이터를 불러오지 못했습니다 (${res.status})`)
    return res.json()
  },
  exportCsvUrl: (id: number, period?: 1 | 2 | null) =>
    `${API_BASE}/api/matches/${id}/export.csv${period ? `?period=${period}` : ''}`,
  thumbnailUrl: (id: number, trackId: string) =>
    `${API_BASE}/api/matches/${id}/players/${encodeURIComponent(trackId)}/thumbnail.jpg`,

  // ── 트랙 편집 ──────────────────────────────────────────────────
  updatePlayer: (id: number, trackId: string,
                 body: { display_name?: string | null; jersey_number?: number | null; team?: Team; excluded?: boolean }) =>
    req<{ ok: boolean; merged_into?: string | null }>(`/api/matches/${id}/players/${encodeURIComponent(trackId)}`, json('PATCH', body)),
  mergePlayers: (id: number, target: string, sources: string[]) =>
    req<{ ok: boolean }>(`/api/matches/${id}/players/merge`, json('POST', { target, sources })),
  unmergePlayer: (id: number, trackId: string) =>
    req<{ ok: boolean }>(`/api/matches/${id}/players/${encodeURIComponent(trackId)}/unmerge`, json('POST')),

  // ── AI 선수 분석 ───────────────────────────────────────────────
  /** 저장된 분석. 아직 없으면(404) null */
  getPlayerReport: async (id: number, trackId: string): Promise<PlayerReport | null> => {
    try {
      return await req<PlayerReport>(`/api/matches/${id}/players/${encodeURIComponent(trackId)}/ai-report`)
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null
      throw e
    }
  },
  /** 새로 분석해 저장 (있으면 덮어씀). 수십 초 걸린다. 서버에 키가 없으면 ApiError(503) */
  createPlayerReport: (id: number, trackId: string) =>
    req<PlayerReport>(`/api/matches/${id}/players/${encodeURIComponent(trackId)}/ai-report`, json('POST')),

  // ── AI 경기 요약 ───────────────────────────────────────────────
  /** 저장된 요약. 아직 없으면(404) null */
  getMatchSummary: async (id: number): Promise<MatchSummary | null> => {
    try {
      return await req<MatchSummary>(`/api/matches/${id}/ai-summary`)
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null
      throw e
    }
  },
  createMatchSummary: (id: number) => req<MatchSummary>(`/api/matches/${id}/ai-summary`, json('POST')),

  // ── 이벤트 검수 ────────────────────────────────────────────────
  updateEvent: (id: number, eventId: number, body: EventPatch) =>
    req<{ ok: boolean }>(`/api/matches/${id}/events/${eventId}`, json('PATCH', body)),
  createEvent: (id: number, body: EventCreate) =>
    req<{ ok: boolean; id: number }>(`/api/matches/${id}/events`, json('POST', body)),
  resetEvents: (id: number) => req<{ ok: boolean }>(`/api/matches/${id}/events/reset`, json('POST')),

  // ── 영상 보관함 ────────────────────────────────────────────────
  getVideos: () => req<VideoLibrary>('/api/videos'),
  attachVideoUrl: (id: number, video_url: string, filename: string) =>
    req<{ video_url: string }>(`/api/matches/${id}/set-video-url`, json('POST', { video_url, filename })),

  // ── 선수 프로필 ────────────────────────────────────────────────
  getClubs: () => req<Club[]>('/api/teams'),
  getClub: (id: number) => req<Club>(`/api/teams/${id}`),
  createClub: (body: ClubInput) => req<Club>('/api/teams', json('POST', body)),
  updateClub: (id: number, body: ClubInput) => req<Club>(`/api/teams/${id}`, json('PUT', body)),
  deleteClub: (id: number) => req<void>(`/api/teams/${id}`, json('DELETE')),
  getSeason: (id: number, year?: number) => req<Season>(`/api/teams/${id}/season${year ? `?year=${year}` : ''}`),
  getTeamMembers: (id: number) => req<TeamMembers>(`/api/teams/${id}/members`),
  newInvite: (id: number) => req<{ invite_code: string }>(`/api/teams/${id}/invite`, json('POST')),
  joinTeam: (code: string) => req<Club>('/api/teams/join', json('POST', { code })),
  setMemberRole: (id: number, userId: number, role: TeamRole) => req<{ ok: boolean }>(`/api/teams/${id}/members/${userId}`, json('PATCH', { role })),
  removeMember: (id: number, userId: number) => req<void>(`/api/teams/${id}/members/${userId}`, json('DELETE')),
  billingConfig: () => req<BillingConfig>('/api/billing/config'),
  matchAccess: (id: number) => req<MatchAccess>(`/api/billing/matches/${id}/access`),
  useTrial: (id: number) => req<MatchAccess>(`/api/billing/matches/${id}/trial`, json('POST')),
  createOrder: (body: { product: 'match' | 'team_month'; match_id?: number; team_id?: number; back?: string }) =>
    req<{ order_id: string; amount: number; order_name: string; mode: 'test' | 'live'; script: string; params: Record<string, string> }>(
      '/api/billing/orders', json('POST', body)),
  getPlayerProfiles: () => req<PlayerProfile[]>('/api/players'),
  getPlayerProfile: (name: string) => req<PlayerProfileDetail>(`/api/players/${encodeURIComponent(name)}`),
}
