'use client'
import { useEffect, useState } from 'react'
import { Crown, Gift, X } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { BillingConfig, Match, MatchAccess } from '@/lib/types'

declare global {
  interface Window {
    TossPayments?: ((clientKey: string) => {
      payment: (o: { customerKey: string }) => { requestPayment: (o: Record<string, unknown>) => Promise<void> }
    }) & { ANONYMOUS: string }
  }
}

const SDK = 'https://js.tosspayments.com/v2/standard'

function loadToss(): Promise<NonNullable<Window['TossPayments']>> {
  if (window.TossPayments) return Promise.resolve(window.TossPayments)
  return new Promise((ok, bad) => {
    const s = document.createElement('script')
    s.src = SDK
    s.onload = () => (window.TossPayments ? ok(window.TossPayments) : bad(new Error('결제 모듈을 불러오지 못했습니다')))
    s.onerror = () => bad(new Error('결제 모듈을 불러오지 못했습니다'))
    document.head.appendChild(s)
  })
}

/** 프리미엄 기능을 눌렀는데 권한이 없을 때(API 402) 뜨는 결제 창. 결제가 꺼져 있으면 뜨지 않는다. */
export default function PaywallHost() {
  const [matchId, setMatchId] = useState<number | null>(null)
  const [cfg, setCfg] = useState<BillingConfig | null>(null)
  const [match, setMatch] = useState<Match | null>(null)
  const [access, setAccess] = useState<MatchAccess | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const on = (e: Event) => setMatchId((e as CustomEvent<number>).detail)
    window.addEventListener('paywall', on)
    return () => window.removeEventListener('paywall', on)
  }, [])

  useEffect(() => {
    if (matchId == null) return
    setMatch(null); setAccess(null)
    Promise.all([api.billingConfig(), api.getMatch(matchId), api.matchAccess(matchId)])
      .then(([c, m, a]) => { setCfg(c); setMatch(m); setAccess(a) })
      .catch(e => { toast.error((e as Error).message); setMatchId(null) })
  }, [matchId])

  if (matchId == null || !cfg?.enabled || !match || !access) return null
  const close = () => setMatchId(null)
  const teamId = match.home_team_id ?? match.away_team_id ?? null

  const trial = async () => {
    setBusy(true)
    try {
      await api.useTrial(match.id)
      toast.success('팀의 첫 경기 무료 혜택을 이 경기에 적용했습니다. 다시 눌러 주세요.')
      close()
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }

  const pay = async (product: 'match' | 'team_month') => {
    setBusy(true)
    try {
      const Toss = await loadToss()
      const o = await api.createOrder(product === 'match' ? { product, match_id: match.id } : { product, team_id: teamId! })
      const back = window.location.pathname + window.location.search
      const q = `back=${encodeURIComponent(back)}`
      await Toss(cfg.client_key!).payment({ customerKey: o.customer_key ?? Toss.ANONYMOUS }).requestPayment({
        method: 'CARD',
        amount: { currency: 'KRW', value: o.amount },
        orderId: o.order_id,
        orderName: o.order_name,
        successUrl: `${window.location.origin}/billing/success?${q}`,
        failUrl: `${window.location.origin}/billing/fail?${q}`,
      })
    } catch (e) {
      const msg = (e as { message?: string }).message
      if (msg && !/취소|cancel/i.test(msg)) toast.error(msg)
      setBusy(false)
    }
  }

  const won = (n: number) => `${n.toLocaleString('ko-KR')}원`
  return (
    <div className="fixed inset-0 z-[80] bg-black/80 flex items-center justify-center p-4" onClick={close}>
      <div role="dialog" aria-modal="true" aria-label="프리미엄 기능" onClick={e => e.stopPropagation()}
        className="bg-ink-900 border border-ink-700 rounded-lg p-5 w-full max-w-md space-y-4">
        <div className="flex items-center">
          <p className="font-semibold text-ink-100 flex-1 flex items-center gap-2"><Crown className="w-4 h-4 text-volt" />프리미엄 기능</p>
          <button onClick={close} className="btn-ghost !p-1.5" aria-label="닫기"><X className="w-5 h-5" /></button>
        </div>
        <ul className="text-sm text-ink-300 space-y-1 list-disc pl-5">
          <li>고정밀 GPU 분석 (초당 15장면, 대형 선수 모델, 작은 공 4분할 검출)</li>
          <li>AI 경기 요약·MOM 후보, 선수별 AI 분석·평점</li>
        </ul>
        {access.trial_available && (
          <button className="btn-primary w-full" disabled={busy} onClick={trial}>
            <Gift className="w-4 h-4" />팀 첫 경기 무료로 쓰기
          </button>
        )}
        <div className="grid gap-2">
          <button className="btn-secondary w-full justify-between" disabled={busy} onClick={() => pay('match')}>
            <span>이 경기 경기권</span><b className="num">{won(cfg.prices.match)}</b>
          </button>
          <button className="btn-secondary w-full justify-between" disabled={busy || !teamId} onClick={() => pay('team_month')}
            title={teamId ? undefined : '경기 설정에서 등록된 팀을 연결하면 살 수 있습니다'}>
            <span>팀 월 이용권 (30일, 팀 경기 전부)</span><b className="num">{won(cfg.prices.team_month)}</b>
          </button>
        </div>
        {!teamId && <p className="text-[11px] text-ink-500">경기 설정에서 등록된 팀을 연결하면 팀 첫 경기 무료와 팀 월 이용권을 쓸 수 있습니다.</p>}
        <p className="text-[11px] text-ink-500">결제는 토스페이먼츠로 처리됩니다. 기본 분석·영상 검수·선수 정리는 계속 무료입니다.</p>
      </div>
    </div>
  )
}
