'use client'
import { useEffect, useSyncExternalStore } from 'react'

/**
 * 카카오 로그인 토큰. API와 사이트 도메인이 달라 쿠키 대신 토큰을 저장해 Authorization 헤더로 보낸다.
 * 로그인 설정(카카오 키)이 없으면 로그인 버튼이 보이지 않고, 사이트는 로그인 없이 동작한다.
 */
const KEY = 'fa_token'

export interface AuthUser {
  id: number
  nickname: string | null
  profile_image: string | null
  teams: { id: number; name: string; color: string; role: 'owner' | 'manager' | 'member' }[]
}

interface AuthState { enabled: boolean | null; user: AuthUser | null; loading: boolean }

let state: AuthState = { enabled: null, user: null, loading: true }
const listeners = new Set<() => void>()
const emit = (s: Partial<AuthState>) => { state = { ...state, ...s }; listeners.forEach(l => l()) }

export function getToken(): string | null {
  try { return localStorage.getItem(KEY) } catch { return null }
}

export function setToken(t: string | null) {
  try { if (t) localStorage.setItem(KEY, t); else localStorage.removeItem(KEY) } catch { /* 저장 불가 브라우저 */ }
}

let started = false
export async function refreshAuth(apiBase: string) {
  started = true
  try {
    const cfg = await fetch(`${apiBase}/api/auth/config`).then(r => r.json()).catch(() => ({ kakao: false }))
    const token = getToken()
    let user: AuthUser | null = null
    if (token) {
      const r = await fetch(`${apiBase}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      if (r.ok) user = await r.json()
      else if (r.status === 401) setToken(null)   // 만료·서명 키 변경
    }
    emit({ enabled: !!cfg.kakao, user, loading: false })
  } catch {
    emit({ loading: false })
  }
}

export function logout() {
  setToken(null)
  emit({ user: null })
}

export function loginUrl(apiBase: string, next?: string) {
  const path = next ?? (typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/')
  return `${apiBase}/api/auth/kakao/start?next=${encodeURIComponent(path)}`
}

export function useAuth(apiBase: string): AuthState {
  const s = useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb) }, () => state, () => state)
  useEffect(() => { if (!started) refreshAuth(apiBase) }, [apiBase])
  return s
}
