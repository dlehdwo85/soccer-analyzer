'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { BarChart3, CloudOff, Film, Plus, Sparkles } from 'lucide-react'
import { api } from '@/lib/api'
import { VideoLibrary } from '@/lib/types'
import PageHeader from '@/components/layout/PageHeader'
import StatusBadge from '@/components/ui/StatusBadge'
import { SOURCE_LABEL } from '@/lib/utils'

export default function VideosPage() {
  const [lib, setLib] = useState<VideoLibrary | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.getVideos().then(setLib).catch(e => setError((e as Error).message))
  }, [])

  const todo = lib?.matches.filter(v => v.needs_analysis) ?? []
  const done = lib?.matches.filter(v => !v.needs_analysis) ?? []

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <PageHeader eyebrow="영상 보관함" title="올려 둔 경기 영상"
        subtitle="예전에 올린 영상도 여기서 찾아 새 분석 엔진으로 다시 분석할 수 있습니다." />

      {error && <div className="card p-4 text-sm text-red-300 border-red-500/30">{error}</div>}
      {!lib && !error && <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="card h-16 animate-pulse" />)}</div>}

      {lib && (
        <div className="space-y-8">
          <Section icon={<Sparkles className="w-4 h-4 text-sky-300" />} title="새 엔진으로 분석할 영상" count={todo.length}
            empty="다시 분석할 영상이 없습니다">
            {todo.map(v => (
              <Row key={v.match_id} title={v.title} sub={`${v.video_filename ?? ''}${v.date ? ` · ${v.date}` : ''}`}
                badge={<StatusBadge status={v.status} />}
                note={v.analysis_version === 2 ? `${SOURCE_LABEL[v.data_source ?? ''] ?? ''} 분석 결과만 있음` : '예전 버전 결과 — 실제 영상 기반이 아님'}
                action={<Link href={`/matches/${v.match_id}#analyze`} className="btn-primary !py-1.5 text-xs"><Sparkles className="w-3.5 h-3.5" />분석하기</Link>} />
            ))}
          </Section>

          <Section icon={<CloudOff className="w-4 h-4 text-amber-300" />} title="저장소에만 남아 있는 영상" count={lib.orphans.length}
            empty={lib.storage ? '경기에 연결되지 않은 영상이 없습니다' : '영상 저장소(R2)가 설정되지 않아 조회할 수 없습니다'}>
            {lib.orphans.map(o => (
              <Row key={o.key} title={o.filename} sub={`${o.size_mb.toLocaleString()} MB${o.last_modified ? ` · ${o.last_modified.slice(0, 10)} 업로드` : ''}`}
                note="어느 경기에도 연결되어 있지 않습니다"
                action={
                  <Link href={`/matches/new?video=${encodeURIComponent(o.url)}&filename=${encodeURIComponent(o.filename)}`}
                    className="btn-secondary !py-1.5 text-xs"><Plus className="w-3.5 h-3.5" />이 영상으로 경기 만들기</Link>
                } />
            ))}
          </Section>

          <Section icon={<BarChart3 className="w-4 h-4 text-volt" />} title="분석이 끝난 영상" count={done.length} empty="아직 없습니다">
            {done.map(v => (
              <Row key={v.match_id} title={v.title} sub={`${v.video_filename ?? ''}${v.date ? ` · ${v.date}` : ''}`}
                badge={<StatusBadge status={v.status} />}
                action={<Link href={`/matches/${v.match_id}/results`} className="btn-secondary !py-1.5 text-xs">결과 보기</Link>} />
            ))}
          </Section>
        </div>
      )}
    </div>
  )
}

function Section({ icon, title, count, empty, children }:
  { icon: React.ReactNode; title: string; count: number; empty: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="flex items-center gap-2 font-extrabold text-ink-100 mb-3">{icon}{title}<span className="text-ink-500 font-semibold num">{count}</span></h2>
      {count === 0 ? <p className="card p-5 text-sm text-ink-500">{empty}</p> : <div className="space-y-2">{children}</div>}
    </section>
  )
}

function Row({ title, sub, note, badge, action }:
  { title: string; sub: string; note?: string; badge?: React.ReactNode; action: React.ReactNode }) {
  return (
    <div className="card p-4 flex flex-wrap sm:flex-nowrap items-center gap-3">
      <span className="w-10 h-10 rounded-xl bg-ink-800 flex items-center justify-center shrink-0"><Film className="w-5 h-5 text-ink-400" /></span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-bold text-ink-100 truncate">{title}</p>
          {badge}
        </div>
        <p className="text-xs text-ink-500 truncate">{sub}</p>
        {note && <p className="text-[11px] text-ink-400 mt-0.5">{note}</p>}
      </div>
      <div className="shrink-0 w-full sm:w-auto flex justify-end">{action}</div>
    </div>
  )
}
