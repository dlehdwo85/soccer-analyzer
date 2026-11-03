'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, ArrowDown, Save, Trash2, Trophy } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { Club, RosterEntry, Season, SeasonPlayer } from '@/lib/types'
import { cn, fmtDateShort } from '@/lib/utils'
import PageHeader from '@/components/layout/PageHeader'
import ColorPicker from '@/components/match/ColorPicker'

/** "10 홍길동" / "홍길동 10" / "홍길동" 한 줄에 한 명 */
function parseRoster(text: string): RosterEntry[] {
  return text.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const m = l.match(/^(\d{1,3})[\s.,)-]+(.+)$/) || l.match(/^(.+?)[\s,]+(\d{1,3})$/)
    if (!m) return { number: null, name: l }
    const [num, name] = /^\d/.test(m[1]) ? [m[1], m[2]] : [m[2], m[1]]
    return { number: Number(num), name: name.trim() }
  })
}

const rosterText = (r: RosterEntry[]) => r.map(x => (x.number != null ? `${x.number} ${x.name}` : x.name)).join('\n')

type SortKey = 'matches' | 'minutes' | 'goals' | 'pass_accuracy' | 'key_passes' | 'shots' | 'defense' | 'touches'
const COLS: { key: SortKey; label: string; value: (p: SeasonPlayer) => number | null; fmt?: (p: SeasonPlayer) => string }[] = [
  { key: 'matches', label: '경기', value: p => p.matches },
  { key: 'minutes', label: '출전(분)', value: p => p.minutes, fmt: p => p.minutes.toFixed(0) },
  { key: 'goals', label: '골(추정)', value: p => p.goals },
  { key: 'touches', label: '터치', value: p => p.touches },
  { key: 'pass_accuracy', label: '패스 성공률', value: p => p.pass_accuracy, fmt: p => (p.pass_accuracy != null ? `${p.pass_accuracy.toFixed(0)}%` : '–') },
  { key: 'key_passes', label: '키패스', value: p => p.key_passes },
  { key: 'shots', label: '슈팅(유효)', value: p => p.shots, fmt: p => `${p.shots}(${p.shots_on_target})` },
  { key: 'defense', label: '가로채기+탈취', value: p => p.interceptions + p.recoveries },
]

export default function TeamPage() {
  const { id } = useParams<{ id: string }>()
  const teamId = Number(id)
  const router = useRouter()
  const [club, setClub] = useState<Club | null>(null)
  const [name, setName] = useState('')
  const [color, setColor] = useState('#56b4d3')
  const [roster, setRoster] = useState('')
  const [saving, setSaving] = useState(false)
  const [year, setYear] = useState<number | undefined>(new Date().getFullYear())
  const [season, setSeason] = useState<Season | null>(null)
  const [sort, setSort] = useState<SortKey>('matches')

  useEffect(() => {
    api.getClub(teamId).then(c => {
      setClub(c); setName(c.name); setColor(c.color); setRoster(rosterText(c.roster))
    }).catch(e => toast.error((e as Error).message))
  }, [teamId])

  const loadSeason = useCallback(() => {
    setSeason(null)
    api.getSeason(teamId, year).then(setSeason).catch(e => toast.error((e as Error).message))
  }, [teamId, year])
  useEffect(() => { loadSeason() }, [loadSeason])

  const parsed = useMemo(() => parseRoster(roster), [roster])
  const dirty = !!club && (name !== club.name || color !== club.color || rosterText(parsed) !== rosterText(club.roster))

  const save = async () => {
    setSaving(true)
    try {
      const c = await api.updateClub(teamId, { name: name.trim(), color, roster: parsed })
      setClub(c); setRoster(rosterText(c.roster))
      toast.success('저장했습니다')
      loadSeason()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!confirm(`'${club?.name}' 팀을 지울까요? 경기 기록은 남고 팀 연결만 끊깁니다.`)) return
    await api.deleteClub(teamId)
    toast.success('팀을 지웠습니다')
    router.push('/teams')
  }

  const col = COLS.find(c => c.key === sort)!
  const rows = season ? [...season.players].sort((a, b) => (col.value(b) ?? -1) - (col.value(a) ?? -1) || b.minutes - a.minutes) : []
  const rec = season?.record
  const thisYear = new Date().getFullYear()

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <PageHeader eyebrow="팀" title={club?.name ?? '팀'} subtitle={club ? `명단 ${club.roster.length}명 · 연결된 경기 ${club.match_count}개` : undefined}
        actions={<Link href="/teams" className="btn-ghost"><ArrowLeft className="w-4 h-4" />팀 목록</Link>} />

      <div className="grid lg:grid-cols-[320px_1fr] gap-4 items-start">
        <section className="card p-4 space-y-3 min-w-0" aria-label="팀 정보와 명단">
          <div>
            <label className="label mb-1 block" htmlFor="tn">팀 이름</label>
            <input id="tn" className="input" value={name} maxLength={100} onChange={e => setName(e.target.value)} />
          </div>
          <ColorPicker label="유니폼" value={color} onChange={setColor} />
          <div>
            <label className="label mb-1 block" htmlFor="roster">명단 (한 줄에 한 명 · &ldquo;10 홍길동&rdquo;)</label>
            <textarea id="roster" className="input font-mono min-h-[220px]" value={roster} onChange={e => setRoster(e.target.value)}
              placeholder={'1 김골키\n7 손흥민\n10 이강인'} />
            <p className="text-[11px] text-ink-500 mt-1">경기 결과의 &lsquo;선수 정리&rsquo;에서 트랙에 이 명단의 이름을 고르면, 같은 이름을 고른 트랙은 자동으로 합쳐집니다.</p>
          </div>
          <div className="flex gap-2">
            <button className="btn-primary flex-1" disabled={!dirty || saving || !name.trim()} onClick={save}>
              <Save className="w-4 h-4" />저장
            </button>
            <button className="btn-secondary" onClick={remove} aria-label="팀 지우기"><Trash2 className="w-4 h-4" /></button>
          </div>
        </section>

        <section className="space-y-4 min-w-0" aria-label="시즌 기록">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-ink-100 flex-1">시즌 기록</h2>
            <select className="input !w-auto !py-1.5" value={year ?? ''} onChange={e => setYear(e.target.value ? Number(e.target.value) : undefined)}
              aria-label="시즌">
              {[thisYear, thisYear - 1, thisYear - 2].map(y => <option key={y} value={y}>{y} 시즌</option>)}
              <option value="">전체</option>
            </select>
          </div>

          {!season ? <div className="card h-40 animate-pulse" /> : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Stat label="분석한 경기" value={String(rec!.played)} />
                <Stat label="전적 (점수 자막)" value={rec!.scored_known ? `${rec!.win}승 ${rec!.draw}무 ${rec!.loss}패` : '–'}
                  hint={rec!.scored_known < rec!.played ? `점수 자막이 있는 ${rec!.scored_known}경기 기준` : undefined} />
                <Stat label="득점 · 실점" value={rec!.scored_known ? `${rec!.goals_for} · ${rec!.goals_against}` : '–'} />
                <Stat label="명단" value={`${season.team.roster.length}명`} />
              </div>

              <div className="card overflow-x-auto">
                <div className="px-4 pt-3 pb-2 flex items-center gap-2">
                  <Trophy className="w-4 h-4 text-volt" />
                  <h3 className="font-semibold text-ink-100 text-sm">선수 순위표</h3>
                  <span className="text-[11px] text-ink-500">이름을 붙인 선수만 · 열 이름을 누르면 정렬</span>
                </div>
                {rows.length === 0 ? (
                  <p className="px-4 pb-4 text-sm text-ink-500">아직 기록이 없습니다. 경기 결과의 &lsquo;선수 정리&rsquo;에서 선수에게 이름을 붙이세요.</p>
                ) : (
                  <table className="w-full text-sm num">
                    <thead>
                      <tr className="text-[11px] text-ink-400 border-t border-ink-800">
                        <th scope="col" className="text-left font-medium px-4 py-2">선수</th>
                        {COLS.map(c => (
                          <th key={c.key} scope="col" className="text-right font-medium px-2 py-2 whitespace-nowrap last:pr-4">
                            <button className={cn('inline-flex items-center gap-0.5 hover:text-ink-100', sort === c.key && 'text-volt')}
                              onClick={() => setSort(c.key)} aria-pressed={sort === c.key}>
                              {c.label}{sort === c.key && <ArrowDown className="w-3 h-3" />}
                            </button>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((p, i) => (
                        <tr key={p.name} className={cn('border-t border-ink-800', p.matches === 0 && 'text-ink-500')}>
                          <td className="px-4 py-2 whitespace-nowrap">
                            <span className="text-ink-500 w-5 inline-block">{p.matches ? i + 1 : ''}</span>
                            {p.number != null && <span className="text-ink-400 mr-1">{p.number}</span>}
                            {p.matches ? (
                              <Link href={`/players/${encodeURIComponent(p.name)}`} className="text-ink-100 hover:text-volt">{p.name}</Link>
                            ) : p.name}
                            {!p.in_roster && <span className="ml-1 text-[10px] text-ink-500">(명단 밖)</span>}
                          </td>
                          {COLS.map(c => (
                            <td key={c.key} className={cn('text-right px-2 py-2 last:pr-4', sort === c.key && 'text-ink-100 font-semibold')}>
                              {c.fmt ? c.fmt(p) : c.value(p)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <p className="px-4 py-2 text-[11px] text-ink-500 border-t border-ink-800">
                  골(추정)은 영상 점수 자막이 바뀌기 직전 그 팀 슈팅 선수입니다. 영상 분석 기록이라 실제와 다를 수 있습니다.
                </p>
              </div>

              <div className="card">
                <h3 className="font-semibold text-ink-100 text-sm px-4 pt-3 pb-2">경기</h3>
                {season.matches.length === 0 ? (
                  <p className="px-4 pb-4 text-sm text-ink-500">이 시즌에 연결된 분석 경기가 없습니다. 경기 설정에서 &lsquo;등록된 팀&rsquo;으로 이 팀을 고르세요.</p>
                ) : season.matches.map(m => (
                  <Link key={m.match_id} href={`/matches/${m.match_id}/results`}
                    className="flex items-center gap-3 px-4 py-2.5 border-t border-ink-800 hover:bg-ink-800/50 text-sm">
                    <span className="text-ink-500 w-20 shrink-0 num">{fmtDateShort(m.date) || '–'}</span>
                    <span className="flex-1 min-w-0 truncate text-ink-200">{m.title} <span className="text-ink-500">vs {m.opponent}</span></span>
                    {m.score ? (
                      <span className={cn('num font-semibold', m.score[0] > m.score[1] ? 'text-volt' : m.score[0] < m.score[1] ? 'text-red-300' : 'text-ink-300')}>
                        {m.score[0]} : {m.score[1]}
                      </span>
                    ) : <span className="text-ink-600 text-xs">점수 없음</span>}
                  </Link>
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card p-3">
      <p className="label">{label}</p>
      <p className="text-lg font-semibold text-ink-100 num mt-0.5">{value}</p>
      {hint && <p className="text-[10px] text-ink-500 mt-0.5">{hint}</p>}
    </div>
  )
}
