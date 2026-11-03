'use client'
import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { api, API_BASE } from '@/lib/api'
import { loginUrl, useAuth } from '@/lib/auth'

function Join() {
  const router = useRouter()
  const code = useSearchParams().get('code') ?? ''
  const auth = useAuth(API_BASE)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (auth.loading || !auth.user || !code) return
    api.joinTeam(code).then(t => {
      toast.success(`${t.name} 팀에 들어왔습니다`)
      router.replace(`/teams/${t.id}`)
    }).catch(e => setErr((e as Error).message))
  }, [auth.loading, auth.user, code, router])

  return (
    <div className="max-w-md mx-auto px-4 py-16">
      <div className="card p-6 text-center space-y-3">
        <p className="text-lg font-semibold text-ink-100">팀 초대</p>
        {!code ? <p className="text-sm text-ink-400">초대 링크가 올바르지 않습니다.</p>
          : err ? <p className="text-sm text-red-300">{err}</p>
          : auth.loading ? <p className="text-sm text-ink-400">확인 중…</p>
          : !auth.enabled ? <p className="text-sm text-ink-400">아직 로그인 기능이 켜지지 않았습니다. 팀 운영진에게 알려 주세요.</p>
          : !auth.user ? (
            <>
              <p className="text-sm text-ink-400">카카오로 로그인하면 바로 팀에 들어갑니다.</p>
              <a href={loginUrl(API_BASE, `/teams/join?code=${encodeURIComponent(code)}`)}
                className="btn w-full bg-[#FEE500] text-[#191919] hover:bg-[#f5dc00] font-semibold">카카오로 로그인</a>
            </>
          ) : <p className="text-sm text-ink-400">팀에 들어가는 중…</p>}
      </div>
    </div>
  )
}

export default function JoinPage() {
  return <Suspense fallback={null}><Join /></Suspense>
}
