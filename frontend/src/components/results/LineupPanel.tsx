'use client'
import { useEffect, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { Club, Match, PlayerRow, RosterEntry, Team } from '@/lib/types'
import { cn, teamInfo } from '@/lib/utils'

/** 이 경기 명단: 저장된 명단이 없으면 이 경기에 이미 넣은 이름으로 시작한다 */
export function effectiveLineup(match: Match, players: PlayerRow[], side: Team): string[] {
  const saved = match.lineup?.[side]
  if (saved) return saved
  const used: string[] = []
  for (const p of players) {
    const n = p.team === side && !p.excluded ? p.display_name?.trim() : null
    if (n && !used.includes(n)) used.push(n)
  }
  return used.sort((a, b) => a.localeCompare(b, 'ko'))
}

/**
 * 선수 정리 위쪽의 '오늘 명단'. 여기서 이 경기에 뛴 사람을 정해 두면, 경기 화면 이름 칸에서는 이름을 치지 않고 누르기만 한다.
 * 등록된 팀 명단에서 골라 넣거나, 게스트처럼 명단에 없는 이름은 직접 추가한다.
 */
export default function LineupPanel({ matchId, match, players, side, roster, onChanged }: {
  matchId: number; match: Match; players: PlayerRow[]; side: Team
  roster?: RosterEntry[]; onChanged: () => Promise<void>
}) {
  const lineup = effectiveLineup(match, players, side)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  // 경기에 팀이 연결돼 있지 않으면, 등록된 팀 중에서 명단을 불러와 고를 수 있게 한다
  const [clubs, setClubs] = useState<Club[]>([])
  const [pickClub, setPickClub] = useState<number | null>(null)
  useEffect(() => {
    if (roster?.length || !open) return
    api.getClubs().then(cs => {
      setClubs(cs.filter(c => c.roster.length))
      const guess = cs.find(c => c.roster.length && (c.name.includes(teamInfo(match, side).name) || teamInfo(match, side).name.includes(c.name)))
      if (guess) setPickClub(guess.id)
    }).catch(() => undefined)
  }, [roster, open, match, side])
  const source = roster?.length ? roster : clubs.find(c => c.id === pickClub)?.roster ?? []
  const used = new Set(players.filter(p => p.team === side && !p.excluded && p.display_name).map(p => p.display_name!.trim()))

  const save = async (next: string[], ok: string) => {
    setBusy(true)
    try {
      await api.updateMatch(matchId, { lineup: { [side]: next } })
      await onChanged()
      toast.success(ok)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const add = (name: string) => {
    const n = name.trim()
    if (!n || lineup.includes(n)) return
    void save([...lineup, n], `명단에 ${n}을(를) 넣었습니다`)
    setDraft('')
  }
  const remove = (name: string) => save(lineup.filter(n => n !== name), `명단에서 ${name}을(를) 뺐습니다`)

  return (
    <section className="card p-3 space-y-2" aria-label="오늘 명단">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <p className="font-semibold text-ink-100 text-sm">{teamInfo(match, side).name} 오늘 명단 <span className="num text-ink-400">{lineup.length}</span>명</p>
        <p className="text-xs text-ink-500">아래 경기 화면 이름 칸에서는 이 명단의 이름을 누르기만 하면 됩니다.</p>
        <button type="button" className="ml-auto btn-ghost !py-1 !px-2 text-xs" onClick={() => setOpen(o => !o)}>
          {open ? '명단 정하기 닫기' : '명단 정하기'}
        </button>
      </div>
      <div className="flex flex-wrap gap-1">
        {lineup.length === 0 && <span className="text-xs text-ink-500">아직 명단이 없습니다. &lsquo;명단 정하기&rsquo;에서 오늘 뛴 선수를 넣어 주세요.</span>}
        {lineup.map(n => (
          <span key={n} className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs',
            used.has(n) ? 'bg-volt/15 text-volt' : 'bg-ink-800 text-ink-300')}>
            {n}
            {open && (
              <button type="button" disabled={busy} onClick={() => remove(n)} aria-label={`${n} 명단에서 빼기`}
                className="rounded-full hover:bg-black/30"><X className="w-3 h-3" /></button>
            )}
          </span>
        ))}
      </div>
      {open && (
        <div className="space-y-2 border-t border-ink-800 pt-2">
          {!roster?.length && clubs.length > 0 && (
            <label className="flex items-center gap-2 text-xs text-ink-400">
              팀 명단 불러오기
              <select className="input !py-1 !w-auto text-xs" value={pickClub ?? ''} onChange={e => setPickClub(e.target.value ? Number(e.target.value) : null)}>
                <option value="">팀 고르기</option>
                {clubs.map(c => <option key={c.id} value={c.id}>{c.name} ({c.roster.length}명)</option>)}
              </select>
            </label>
          )}
          {source.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {source.filter(r => !lineup.includes(r.name)).map(r => (
                <button key={r.name} type="button" disabled={busy} onClick={() => add(r.name)}
                  className="inline-flex items-center gap-0.5 rounded-full border border-ink-700 px-2 py-0.5 text-xs text-ink-300 hover:border-volt hover:text-volt">
                  <Plus className="w-3 h-3" />{r.number != null && `${r.number} `}{r.name}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-1.5">
            <input className="input !py-1 !px-2 text-sm" placeholder="명단에 없는 이름 (게스트 등)" value={draft} maxLength={100}
              onChange={e => setDraft(e.target.value)} onKeyDown={e => e.key === 'Enter' && add(draft)} aria-label="명단에 이름 추가" />
            <button type="button" className="btn-secondary !py-1 !px-2 text-xs shrink-0" disabled={busy || !draft.trim()} onClick={() => add(draft)}>
              <Plus className="w-3.5 h-3.5" />추가
            </button>
          </div>
          <p className="text-[11px] text-ink-500">초록색은 이 경기에서 이미 이름을 넣은 선수입니다. 명단에서 빼도 이미 넣은 이름은 그대로 남습니다.</p>
        </div>
      )}
    </section>
  )
}
