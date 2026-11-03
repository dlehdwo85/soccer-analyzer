'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, ArrowDown, Copy, Link2, Lock, Save, Trash2, Trophy, UserMinus } from 'lucide-react'
import { toast } from 'sonner'
import { api, API_BASE } from '@/lib/api'
import { loginUrl, useAuth } from '@/lib/auth'
import { Club, RosterEntry, Season, SeasonPlayer, TeamMembers, TeamRole } from '@/lib/types'
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
        <div className="space-y-4 min-w-0">
        <section className="card p-4 space-y-3" aria-label="팀 정보와 명단">
          {club && club.can_edit === false && (
            <p className="text-[11px] text-ink-400 flex items-center gap-1"><Lock className="w-3 h-3" />명단·팀 정보는 팀장·운영진만 고칠 수 있습니다.</p>
          )}
          <fieldset disabled={club?.can_edit === false} className="space-y-3 disabled:opacity-60">
          <div>
            <label className="label mb-1 block" htmlFor="tn">팀 이름</label>
            <input id="tn" className="input" value={name} maxLength={100} onChange={e => setName(e.target.value)} />
          </div>
          <ColorPicker label="유니폼" value={color} onChange={setColor} />
          <div>
            <label className="label mb-1 block" htmlFor="roster">명단 (한 줄에 한 명 · 등번호는 없어도 됩니다)</label>
            <textarea id="roster" className="input font-mono min-h-[220px]" value={roster} onChange={e => setRoster(e.target.value)}
              placeholder={'김골키\n7 손흥민\n이강인'} />
            <p className="text-[11px] text-ink-500 mt-1">경기 결과의 &lsquo;선수 정리&rsquo;에서 썸네일을 보고 트랙에 이 명단의 이름을 고르면, 같은 이름을 고른 트랙은 자동으로 합쳐집니다. 기록은 이름으로 모이므로 등번호가 없어도 됩니다.</p>
          </div>
          <div className="flex gap-2">
            <button className="btn-primary flex-1" disabled={!dirty || saving || !name.trim()} onClick={save}>
              <Save className="w-4 h-4" />저장
            </button>
            <button className="btn-secondary" onClick={remove} aria-label="팀 지우기"><Trash2 className="w-4 h-4" /></button>
          </div>
          </fieldset>
        </section>
        <Members teamId={teamId} onChanged={() => api.getClub(teamId).then(setClub)} />
        </div>

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


const ROLE_LABEL: Record<TeamRole, string> = { owner: '팀장', manager: '운영진', member: '팀원' }

/** 팀원·초대 링크 (카카오 로그인이 켜져 있을 때만) */
function Members({ teamId, onChanged }: { teamId: number; onChanged: () => void }) {
  const auth = useAuth(API_BASE)
  const [data, setData] = useState<TeamMembers | null>(null)
  const load = useCallback(() => { api.getTeamMembers(teamId).then(setData).catch(() => setData(null)) }, [teamId])
  useEffect(() => { if (auth.enabled) load() }, [auth.enabled, auth.user, load])
  if (!auth.enabled || !data) return null

  const link = data.invite_code ? `${window.location.origin}/teams/join?code=${data.invite_code}` : null
  const isOwner = data.my_role === 'owner'
  const canInvite = !!auth.user && (data.members.length === 0 || data.my_role === 'owner' || data.my_role === 'manager')
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast.success(ok); load(); onChanged() } catch (e) { toast.error((e as Error).message) }
  }
  const copy = async () => {
    if (!link) return
    try {
      if (navigator.share) await navigator.share({ title: '팀 초대', text: '우리 팀 경기 기록에 들어오세요', url: link })
      else { await navigator.clipboard.writeText(link); toast.success('초대 링크를 복사했습니다') }
    } catch { /* 공유 취소 */ }
  }

  return (
    <section className="card p-4 space-y-3" aria-label="팀원">
      <p className="font-semibold text-ink-100 text-sm">팀원 {data.members.length}명</p>
      {data.members.length === 0 && (
        <p className="text-[11px] text-ink-500">아직 팀원이 없어 누구나 이 팀을 고칠 수 있습니다. 초대 링크로 처음 들어온 사람이 팀장이 됩니다.</p>
      )}
      <ul className="space-y-1.5">
        {data.members.map(m => (
          <li key={m.id} className="flex items-center gap-2 text-sm">
            <span className="w-7 h-7 rounded-full overflow-hidden bg-ink-700 flex items-center justify-center text-[11px] shrink-0">
              {m.profile_image ? <img src={m.profile_image} alt="" className="w-full h-full object-cover" /> : (m.nickname ?? '?').slice(0, 1)}
            </span>
            <span className="flex-1 truncate text-ink-200">{m.nickname ?? '카카오 사용자'}{auth.user?.id === m.id && ' (나)'}</span>
            {isOwner ? (
              <select className="input !w-auto !py-0.5 !px-1.5 text-xs" value={m.role} aria-label={`${m.nickname} 권한`}
                onChange={e => act(() => api.setMemberRole(teamId, m.id, e.target.value as TeamRole), '권한을 바꿨습니다')}>
                {(['owner', 'manager', 'member'] as TeamRole[]).map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
            ) : <span className="text-[11px] text-ink-500">{ROLE_LABEL[m.role]}</span>}
            {(auth.user?.id === m.id || data.my_role === 'owner' || data.my_role === 'manager') && (
              <button className="btn-ghost !p-1" aria-label={auth.user?.id === m.id ? '팀 나가기' : '내보내기'}
                onClick={() => confirm(auth.user?.id === m.id ? '팀에서 나갈까요?' : `${m.nickname}님을 내보낼까요?`)
                  && act(() => api.removeMember(teamId, m.id), auth.user?.id === m.id ? '팀에서 나갔습니다' : '내보냈습니다')}>
                <UserMinus className="w-3.5 h-3.5" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {!auth.user ? (
        <a href={loginUrl(API_BASE)} className="btn w-full bg-[#FEE500] text-[#191919] hover:bg-[#f5dc00] font-semibold">카카오로 로그인</a>
      ) : canInvite && (
        <div className="space-y-1.5">
          {link && (
            <div className="flex gap-1.5">
              <input className="input !py-1 text-xs" readOnly value={link} aria-label="초대 링크" onFocus={e => e.currentTarget.select()} />
              <button className="btn-secondary !px-2" onClick={copy} aria-label="초대 링크 공유"><Copy className="w-4 h-4" /></button>
            </div>
          )}
          <button className="btn-secondary w-full text-xs"
            onClick={() => act(() => api.newInvite(teamId), link ? '새 초대 링크를 만들었습니다 (예전 링크는 막힘)' : '초대 링크를 만들었습니다')}>
            <Link2 className="w-3.5 h-3.5" />{link ? '초대 링크 새로 만들기' : '초대 링크 만들기'}
          </button>
        </div>
      )}
    </section>
  )
}
