'use client'
import { useMemo, useState } from 'react'
import { Clapperboard, Play } from 'lucide-react'
import { MatchEvent, MatchResult, PlayerRow, Team } from '@/lib/types'
import { cn, eventLabel, fmtClock, playerName, teamInfo } from '@/lib/utils'
import { Clip } from './VideoDock'

type Item = { t: number; title: string; sub: string; team: Team; tags: string[]; xg?: number }

/** 슈팅(과 그 슈팅을 만든 키패스)을 모아 장면 목록으로 — 연속 재생 */
function buildItems(result: MatchResult, players: Map<string, PlayerRow>): Item[] {
  const ev = [...result.events].sort((a, b) => a.t - b.t)
  const items: Item[] = []
  let lastPass: MatchEvent | null = null
  for (const e of ev) {
    if (e.kind === 'pass') { lastPass = e.success && e.target ? e : null; continue }
    if (e.kind === 'recovery') { lastPass = null; continue }
    if (e.kind !== 'shot') continue
    const assisted = lastPass && lastPass.target === e.player && e.t - (lastPass.t_end ?? lastPass.t) <= 8 ? lastPass : null
    const tags: string[] = e.detail.outcome === 'on_target' ? ['유효 슈팅'] : []
    if (assisted) tags.push('키패스')
    if ((e.detail.xg ?? 0) >= 0.3) tags.push('결정적 기회')
    items.push({
      t: assisted ? assisted.t : e.t,
      team: e.team,
      title: `${playerName(players.get(e.player))} ${eventLabel(e)}`,
      sub: assisted ? `${playerName(players.get(assisted.player))}의 패스에서` : '',
      tags,
      xg: e.detail.xg,
    })
    lastPass = null
  }
  return items
}

export default function Highlights({ result, players, onPlay, canPlay }: {
  result: MatchResult; players: Map<string, PlayerRow>; onPlay: (clips: Clip[]) => void; canPlay: boolean
}) {
  const [team, setTeam] = useState<Team | 'all'>('all')
  const [onlyBig, setOnlyBig] = useState(false)
  const all = useMemo(() => buildItems(result, players), [result, players])
  const list = all.filter(i => (team === 'all' || i.team === team) && (!onlyBig || i.tags.includes('유효 슈팅') || i.tags.includes('결정적 기회')))
  const clips = list.map(i => ({ t: i.t, label: i.title }))

  return (
    <section className="space-y-3">
      <div className="card p-4 flex flex-wrap items-center gap-2">
        {(['all', 'home', 'away'] as const).map(t => (
          <button key={t} onClick={() => setTeam(t)} className={cn('chip', team === t && 'chip-on')}>
            {t === 'all' ? '양 팀' : teamInfo(result.match, t).name}
          </button>
        ))}
        <label className="flex items-center gap-1.5 text-xs text-ink-300 ml-1 cursor-pointer">
          <input type="checkbox" checked={onlyBig} onChange={e => setOnlyBig(e.target.checked)} />유효 슈팅·결정적 기회만
        </label>
        <button className="btn-primary ml-auto" disabled={!canPlay || !clips.length} onClick={() => onPlay(clips)}>
          <Clapperboard className="w-4 h-4" />하이라이트 {clips.length}개 이어보기
        </button>
      </div>
      {!canPlay && <p className="text-xs text-ink-500 px-1">영상이 연결된 경기에서 장면을 재생할 수 있습니다.</p>}
      {list.length === 0 ? (
        <div className="card p-10 text-center text-ink-500 text-sm">슈팅 장면이 없습니다</div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {list.map((i, idx) => {
            const t = teamInfo(result.match, i.team)
            return (
              <button key={idx} disabled={!canPlay} onClick={() => onPlay([{ t: i.t, label: i.title }])}
                className="card-hover p-4 text-left group disabled:cursor-default">
                <div className="flex items-center gap-2 mb-2">
                  <span className="num text-xs font-bold text-ink-950 bg-volt rounded-md px-1.5 py-0.5">{fmtClock(i.t)}</span>
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: t.color }} />
                  <span className="text-xs text-ink-400 truncate">{t.name}</span>
                  {canPlay && <Play className="w-4 h-4 ml-auto text-ink-600 group-hover:text-volt" />}
                </div>
                <p className="font-bold text-ink-100">{i.title}</p>
                {i.sub && <p className="text-xs text-ink-400 mt-0.5">{i.sub}</p>}
                <div className="flex flex-wrap gap-1 mt-2.5">
                  {i.tags.map(tag => (
                    <span key={tag} className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded',
                      tag === '유효 슈팅' ? 'bg-volt-soft text-volt' : tag === '결정적 기회' ? 'bg-amber-500/15 text-amber-300' : 'bg-ink-800 text-ink-300')}>
                      {tag}
                    </span>
                  ))}
                  {i.xg != null && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-ink-800 text-ink-300 num">xG {i.xg.toFixed(2)}</span>}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}
