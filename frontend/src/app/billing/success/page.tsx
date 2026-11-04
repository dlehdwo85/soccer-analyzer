'use client'
import { Suspense, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'

const safeBack = (b: string | null) => (b && b.startsWith('/') && !b.startsWith('//') ? b : '/')

/** 나이스페이 결제가 승인된 뒤 API가 보내 주는 곳 (승인은 API가 이미 끝냈다) */
function Success() {
  const router = useRouter()
  const q = useSearchParams()
  useEffect(() => {
    toast.success('결제가 완료됐습니다. 프리미엄 기능을 쓸 수 있습니다.')
    const t = setTimeout(() => router.replace(safeBack(q.get('back'))), 1200)
    return () => clearTimeout(t)
  }, [q, router])
  return (
    <div className="max-w-md mx-auto px-4 py-20 text-center space-y-4">
      <p className="text-ink-100 font-semibold">결제가 완료됐습니다</p>
      <a href={safeBack(q.get('back'))} className="btn-secondary">돌아가기</a>
    </div>
  )
}

export default function SuccessPage() {
  return <Suspense fallback={null}><Success /></Suspense>
}
