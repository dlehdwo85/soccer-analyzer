'use client'
import { useEffect, useState } from 'react'
import { Crown, Gift, X } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { BillingConfig, Match, MatchAccess } from '@/lib/types'

declare global {
  interface Window { goPay?: (f: HTMLFormElement) => void; nicepaySubmit?: () => void; nicepayClose?: () => void }
}

/**
 * 나이스페이 결제창 띄우기 (워크인과 같은 방식). 서버가 서명한 파라미터를 숨은 form에 담아 goPay로 연다.
 * 인증이 끝나면 나이스페이가 form을 ReturnURL(우리 API)로 보내고, API가 승인한 뒤 결과 화면으로 돌려보낸다.
 */
async function launchNicepay(r: { script: string; params: Record<string, string> }, onClose: (msg: string) => void) {
  await new Promise<void>((ok, bad) => {
    if (window.goPay) return ok()
    const s = document.createElement('script')
    s.src = r.script
    s.onload = () => ok()
    s.onerror = () => bad(new Error('결제창을 불러오지 못했습니다. 광고 차단기를 확인하세요'))
    document.head.appendChild(s)
  })
  const f = document.createElement('form')
  f.method = 'post'
  f.action = r.params.ReturnURL
  f.acceptCharset = 'euc-kr'
  f.style.display = 'none'
  for (const [k, v] of Object.entries(r.params)) {
    const i = document.createElement('input')
    i.type = 'hidden'; i.name = k; i.value = v
    f.appendChild(i)
  }
  document.body.appendChild(f)
  window.nicepaySubmit = () => f.submit()
  window.nicepayClose = () => {
    const msg = (f.elements.namedItem('AuthResultMsg') as HTMLInputElement | null)?.value
    onClose(msg || '결제를 취소했습니다')
    f.remove()
  }
  window.goPay!(f)
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
      const back = window.location.pathname + window.location.search
      const o = await api.createOrder(product === 'match' ? { product, match_id: match.id, back } : { product, team_id: teamId!, back })
      await launchNicepay(o, msg => { toast.message(msg); setBusy(false) })
    } catch (e) {
      toast.error((e as Error).message)
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
          <li>고정밀 GPU 분석 (초당 15장면, 대형 선수 모델, 밤 경기까지 학습한 공 모델)</li>
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
        <p className="text-[11px] text-ink-500">
          결제는 나이스페이(나이스정보통신)로 처리됩니다{cfg.mode === 'test' ? ' — 지금은 시험 상점이라 실제로 청구되지 않습니다' : ''}.
          기본 분석·영상 검수·선수 정리는 계속 무료입니다.
        </p>
      </div>
    </div>
  )
}
