'use client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import MatchForm, { DEFAULT_MATCH } from '@/components/match/MatchForm'
import PageHeader from '@/components/layout/PageHeader'

export default function NewMatchPage() {
  const router = useRouter()
  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <PageHeader title="새 경기 등록" subtitle="경기 정보와 유니폼 색을 설정하세요"
        actions={<Link href="/" className="btn-secondary"><ArrowLeft className="w-4 h-4" />목록</Link>} />
      <MatchForm initial={DEFAULT_MATCH} submitLabel="경기 등록" onCancel={() => router.push('/')}
        onSubmit={async v => {
          try {
            const m = await api.createMatch(v)
            toast.success('경기를 등록했습니다')
            router.push(`/matches/${m.id}`)
          } catch (e) {
            toast.error((e as Error).message)
          }
        }} />
    </div>
  )
}
