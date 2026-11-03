'use client'
import { Suspense, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { api } from '@/lib/api'

const safeBack = (b: string | null) => (b && b.startsWith('/') && !b.startsWith('//') ? b : '/')

/** 토스 결제창이 성공하면 오는 곳. 서버가 금액을 확인하고 토스에 승인을 요청한다. */
function Success() {
  const router = useRouter()
  const q = useSearchParams()
  const [msg, setMsg] = useState('결제를 확인하는 중…')
  const once = useRef(false)

  useEffect(() => {
    if (once.current) return
    once.current = true
    const paymentKey = q.get('paymentKey'), orderId = q.get('orderId'), amount = Number(q.get('amount'))
    if (!paymentKey || !orderId || !amount) { setMsg('결제 정보가 없습니다.'); return }
    api.confirmPayment({ paymentKey, orderId, amount }).then(() => {
      toast.success('결제가 완료됐습니다. 프리미엄 기능을 쓸 수 있습니다.')
      router.replace(safeBack(q.get('back')))
    }).catch(e => setMsg((e as Error).message))
  }, [q, router])

  return (
    <div className="max-w-md mx-auto px-4 py-20 text-center space-y-4">
      <p className="text-ink-200">{msg}</p>
      <a href={safeBack(q.get('back'))} className="btn-secondary">돌아가기</a>
    </div>
  )
}

export default function SuccessPage() {
  return <Suspense fallback={null}><Success /></Suspense>
}
