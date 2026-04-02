'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Save } from 'lucide-react'
import Link from 'next/link'
import { api } from '@/lib/api'
import ColorPicker from '@/components/match/ColorPicker'
import PageHeader from '@/components/layout/PageHeader'
import { toast } from 'sonner'

export default function NewMatchPage() {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    title: '', date: new Date().toISOString().split('T')[0],
    field_type: 'soccer',
    home_team_name: '홈팀', away_team_name: '원정팀',
    home_team_color: '#56b4d3',   // 하늘색 (유튜브 영상 기준)
    away_team_color: '#ef4444',   // 빨강
    referee_color: '#facc15',     // 노랑 심판
  })

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title.trim()) { toast.error('경기 제목을 입력해주세요'); return }
    setSaving(true)
    try {
      const match = await api.createMatch(form)
      toast.success('경기가 등록되었습니다!')
      router.push(`/matches/${match.id}`)
    } catch (err: any) {
      toast.error(err.message ?? '등록 실패')
    } finally { setSaving(false) }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <PageHeader title="새 경기 등록" subtitle="경기 정보와 팀 색상을 설정하세요"
        actions={<Link href="/" className="btn-secondary"><ArrowLeft className="w-4 h-4"/>목록으로</Link>}/>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="card p-5 space-y-4">
          <h2 className="font-semibold text-gray-900">경기 정보</h2>
          <div>
            <label className="label mb-1 block">경기 제목 *</label>
            <input className="input" placeholder="예) 2026 봄리그 3쿼터" value={form.title} onChange={e=>set('title',e.target.value)} required/>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label mb-1 block">경기 날짜</label>
              <input type="date" className="input" value={form.date} onChange={e=>set('date',e.target.value)}/></div>
            <div><label className="label mb-1 block">경기 종류</label>
              <select className="input" value={form.field_type} onChange={e=>set('field_type',e.target.value)}>
                <option value="soccer">⚽ 축구 (11vs11)</option>
                <option value="futsal">🏟 풋살 (5vs5)</option>
              </select></div>
          </div>
        </div>

        <div className="card p-5 space-y-5">
          <h2 className="font-semibold text-gray-900">팀 & 심판 색상 설정</h2>
          <p className="text-xs text-gray-500 bg-blue-50 border border-blue-200 rounded-lg p-3">
            💡 영상 분석 정확도를 높이려면 실제 유니폼 색상과 최대한 일치하게 설정하세요.<br/>
            유튜브 영상 기준: 홈=하늘색, 어웨이=빨강, 심판=노랑
          </p>
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-3">
              <div><label className="label mb-1 block">홈팀 이름</label>
                <input className="input" placeholder="홈팀" value={form.home_team_name} onChange={e=>set('home_team_name',e.target.value)}/></div>
              <ColorPicker label="홈팀 유니폼 색상" value={form.home_team_color} onChange={v=>set('home_team_color',v)}/>
            </div>
            <div className="space-y-3">
              <div><label className="label mb-1 block">원정팀 이름</label>
                <input className="input" placeholder="원정팀" value={form.away_team_name} onChange={e=>set('away_team_name',e.target.value)}/></div>
              <ColorPicker label="원정팀 유니폼 색상" value={form.away_team_color} onChange={v=>set('away_team_color',v)}/>
            </div>
          </div>
          <div>
            <ColorPicker label="심판 색상 (제외 처리)" value={form.referee_color} onChange={v=>set('referee_color',v)}/>
          </div>

          {/* 미리보기 */}
          <div className="bg-gray-50 rounded-xl p-4 flex items-center justify-center gap-6">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full border-2 border-white shadow" style={{background:form.home_team_color}}/>
              <span className="font-medium text-sm">{form.home_team_name||'홈팀'}</span>
            </div>
            <span className="text-gray-400 font-bold">VS</span>
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full border-2 border-white shadow" style={{background:form.away_team_color}}/>
              <span className="font-medium text-sm">{form.away_team_name||'원정팀'}</span>
            </div>
            <div className="flex items-center gap-2 ml-4">
              <div className="w-4 h-4 rounded-full border border-gray-300" style={{background:form.referee_color}}/>
              <span className="text-xs text-gray-400">심판</span>
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <Link href="/" className="btn-secondary flex-1 justify-center">취소</Link>
          <button type="submit" disabled={saving} className="btn-primary flex-1 justify-center">
            <Save className="w-4 h-4"/>{saving?'등록 중...':'경기 등록하기'}
          </button>
        </div>
      </form>
    </div>
  )
}
