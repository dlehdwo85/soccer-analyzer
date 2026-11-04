'use client'
import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

const safeBack = (b: string | null) => (b && b.startsWith('/') && !b.startsWith('//') ? b : '/')

function Fail() {
  const q = useSearchParams()
  const canceled = /cancel|취소/i.test(q.get('message') ?? '')
  return (
    <div className="max-w-md mx-auto px-4 py-20 text-center space-y-4">
      <p className="text-ink-100 font-semibold">{canceled ? '결제를 취소했습니다' : '결제하지 못했습니다'}</p>
      {!canceled && q.get('message') && <p className="text-sm text-ink-400">{q.get('message')}</p>}
      <a href={safeBack(q.get('back'))} className="btn-secondary">돌아가기</a>
    </div>
  )
}

export default function FailPage() {
  return <Suspense fallback={null}><Fail /></Suspense>
}
