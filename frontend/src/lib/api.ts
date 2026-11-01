import {
  AnalysisStatus, Calibration, CalibrationInput, EventCreate, EventPatch, Health, Match, MatchInput, MatchResult,
  PlayerProfile, PlayerProfileDetail, Team, VideoLibrary,
} from './types'

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: init?.body instanceof FormData ? init?.headers : { 'Content-Type': 'application/json', ...init?.headers },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    const detail = Array.isArray(err.detail) ? err.detail.map((d: { msg: string }) => d.msg).join(', ') : err.detail
    throw new Error(detail || `요청 실패 (${res.status})`)
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
  videoSrc: (m: Match) =>
    !m.video_url ? null : m.video_url.startsWith('local:') ? `${API_BASE}/api/matches/${m.id}/video` : m.video_url,

  getCalibration: (id: number) => req<Calibration | null>(`/api/matches/${id}/calibration`),
  setCalibration: (id: number, body: CalibrationInput) => req<Match>(`/api/matches/${id}/calibration`, json('PUT', body)),
  clearCalibration: (id: number) => req<Match>(`/api/matches/${id}/calibration`, json('DELETE')),

  analyze: (id: number, body: { mode: 'video' | 'sample'; start_seconds?: number; max_seconds?: number | null }) =>
    req<{ status: string; mode: string }>(`/api/matches/${id}/analyze`, json('POST', body)),
  getStatus: (id: number) => req<AnalysisStatus>(`/api/matches/${id}/status`),
  getResult: (id: number, period?: 1 | 2 | null) =>
    req<MatchResult>(`/api/matches/${id}/result${period ? `?period=${period}` : ''}`),
  exportCsvUrl: (id: number, period?: 1 | 2 | null) =>
    `${API_BASE}/api/matches/${id}/export.csv${period ? `?period=${period}` : ''}`,
  thumbnailUrl: (id: number, trackId: string) =>
    `${API_BASE}/api/matches/${id}/players/${encodeURIComponent(trackId)}/thumbnail.jpg`,

  // ── 트랙 편집 ──────────────────────────────────────────────────
  updatePlayer: (id: number, trackId: string,
                 body: { display_name?: string | null; jersey_number?: number | null; team?: Team; excluded?: boolean }) =>
    req<{ ok: boolean }>(`/api/matches/${id}/players/${encodeURIComponent(trackId)}`, json('PATCH', body)),
  mergePlayers: (id: number, target: string, sources: string[]) =>
    req<{ ok: boolean }>(`/api/matches/${id}/players/merge`, json('POST', { target, sources })),
  unmergePlayer: (id: number, trackId: string) =>
    req<{ ok: boolean }>(`/api/matches/${id}/players/${encodeURIComponent(trackId)}/unmerge`, json('POST')),

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
  getPlayerProfiles: () => req<PlayerProfile[]>('/api/players'),
  getPlayerProfile: (name: string) => req<PlayerProfileDetail>(`/api/players/${encodeURIComponent(name)}`),
}
