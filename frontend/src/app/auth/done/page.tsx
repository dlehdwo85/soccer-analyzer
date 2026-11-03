'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { API_BASE } from '@/lib/api'
import { refreshAuth, setToken } from '@/lib/auth'

/** 카카오 로그인 뒤 서버가 #token=...&next=... 으로 돌려보내는 곳. 토큰을 저장하고 원래 보던 화면으로 간다. */
export default function AuthDone() {
  const router = useRouter()
  const [msg, setMsg] = useState('로그인 처리 중…')

  useEffect(() => {
    const h = new URLSearchParams(window.location.hash.slice(1))
    const token = h.get('token')
    const next = h.get('next') || '/'
    history.replaceState(null, '', window.location.pathname)   // 주소창에서 토큰을 지운다
    if (!token) {
      setMsg('로그인하지 못했습니다. 다시 시도해 주세요.')
      toast.error('카카오 로그인에 실패했습니다')
      return
    }
    setToken(token)
    refreshAuth(API_BASE).then(() => {
      toast.success('로그인했습니다')
      router.replace(next.startsWith('/') && !next.startsWith('//') ? next : '/')
    })
  }, [router])

  return <div className="max-w-md mx-auto px-4 py-20 text-center text-ink-300">{msg}</div>
}
