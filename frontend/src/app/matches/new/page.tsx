'use client'
import { Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Film } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import MatchForm, { DEFAULT_MATCH } from '@/components/match/MatchForm'
import PageHeader from '@/components/layout/PageHeader'

function NewMatch() {
  const router = useRouter()
  const params = useSearchParams()
  const video = params.get('video')
  const filename = params.get('filename') ?? 'video.mp4'
  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <PageHeader eyebrow="새 경기" title="경기 등록" subtitle="팀 이름과 유니폼 색을 정하면 영상 속 선수를 팀별로 나눕니다"
        actions={<Link href="/" className="btn-ghost"><ArrowLeft className="w-4 h-4" />목록</Link>} />
      {video && (
        <div className="card p-4 mb-5 flex items-center gap-3 border-sky-500/30 bg-sky-500/5">
          <Film className="w-5 h-5 text-sky-300 shrink-0" />
          <p className="text-sm text-ink-200 min-w-0">저장소의 영상 <b className="text-sky-300 break-all">{filename}</b>을(를) 이 경기에 연결합니다.</p>
        </div>
      )}
      <MatchForm initial={{ ...DEFAULT_MATCH, title: video ? filename.replace(/\.[^.]+$/, '') : '' }} submitLabel="경기 등록"
        onCancel={() => router.push('/')}
        onSubmit={async v => {
          try {
            const m = await api.createMatch(v)
            if (video) await api.attachVideoUrl(m.id, video, filename)
            toast.success('경기를 등록했습니다')
            router.push(`/matches/${m.id}`)
          } catch (e) {
            toast.error((e as Error).message)
          }
        }} />
    </div>
  )
}

export default function NewMatchPage() {
  return <Suspense fallback={null}><NewMatch /></Suspense>
}
