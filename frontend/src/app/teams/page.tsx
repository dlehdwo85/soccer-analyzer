'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronRight, Plus, Shield } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { Club } from '@/lib/types'
import PageHeader from '@/components/layout/PageHeader'
import ColorPicker from '@/components/match/ColorPicker'

export default function TeamsPage() {
  const router = useRouter()
  const [clubs, setClubs] = useState<Club[] | null>(null)
  const [name, setName] = useState('')
  const [color, setColor] = useState('#56b4d3')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.getClubs().then(setClubs).catch(() => { toast.error('팀 목록을 불러올 수 없습니다'); setClubs([]) })
  }, [])

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    try {
      const c = await api.createClub({ name: name.trim(), color, roster: [] })
      router.push(`/teams/${c.id}`)
    } catch (err) {
      toast.error((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <PageHeader eyebrow="팀" title="우리 팀" subtitle="팀을 등록하고 명단을 넣어 두면 경기마다 선수 정리가 쉬워지고 시즌 기록·순위표가 쌓입니다" />
      <form onSubmit={create} className="card p-4 mb-5 grid sm:grid-cols-[1fr_auto_auto] gap-3 items-end">
        <div>
          <label className="label mb-1 block" htmlFor="team-name">새 팀 이름</label>
          <input id="team-name" className="input" placeholder="예) 월넛FC" value={name} maxLength={100}
            onChange={e => setName(e.target.value)} />
        </div>
        <ColorPicker label="유니폼" value={color} onChange={setColor} />
        <button type="submit" className="btn-primary" disabled={busy || !name.trim()}><Plus className="w-4 h-4" />팀 등록</button>
      </form>
      {clubs === null ? (
        <div className="space-y-2">{[1, 2].map(i => <div key={i} className="card h-16 animate-pulse" />)}</div>
      ) : clubs.length === 0 ? (
        <div className="card p-10 text-center">
          <Shield className="w-10 h-10 text-ink-600 mx-auto mb-3" />
          <p className="text-ink-200 font-bold mb-1">아직 등록한 팀이 없습니다</p>
          <p className="text-sm text-ink-500">팀 이름을 넣고 등록하세요. 경기를 만들 때 이 팀을 고르면 명단이 연결됩니다.</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {clubs.map(c => (
            <Link key={c.id} href={`/teams/${c.id}`} className="card-hover p-4 flex items-center gap-4 group">
              <span className="w-10 h-10 rounded-lg shrink-0 border border-ink-700" style={{ background: c.color }} />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-ink-100 group-hover:text-volt truncate">{c.name}</p>
                <p className="text-xs text-ink-500">명단 {c.roster.length}명 · 경기 {c.match_count}개</p>
              </div>
              <ChevronRight className="w-4 h-4 text-ink-600 group-hover:text-volt" />
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
