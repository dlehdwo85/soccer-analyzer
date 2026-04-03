'use client'
import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Upload, Play, FlaskConical, CheckCircle, Loader2 } from 'lucide-react'
import { Match } from '@/lib/types'
import { api } from '@/lib/api'
import StatusBadge from '@/components/ui/StatusBadge'
import PageHeader from '@/components/layout/PageHeader'
import { fmtDate } from '@/lib/utils'
import { toast } from 'sonner'

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

export default function MatchDetailPage() {
  const { id } = useParams<{ id: string }>()
  const matchId = Number(id)
  const router = useRouter()

  const [match, setMatch] = useState<Match | null>(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [analyzing, setAnalyzing] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = async () => {
    try {
      const m = await api.getMatch(matchId)
      setMatch(m)
    } catch {
      toast.error('경기 정보를 불러올 수 없습니다')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [matchId])

  useEffect(() => {
    if (match?.status !== 'analyzing') return
    const timer = setInterval(async () => {
      try {
        const m = await api.getMatch(matchId)
        setMatch(m)
        if (m.status === 'done') {
          clearInterval(timer)
          toast.success('분석 완료!')
          router.push(`/matches/${matchId}/results`)
        } else if (m.status === 'failed') {
          clearInterval(timer)
          toast.error('분석 실패')
        }
      } catch { clearInterval(timer) }
    }, 3000)
    return () => clearInterval(timer)
  }, [match?.status, matchId, router])

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const ext = file.name.split('.').pop()?.toLowerCase()
    if (!['mp4', 'mov'].includes(ext ?? '')) {
      toast.error('MP4, MOV 파일만 지원합니다')
      return
    }

    setUploading(true)
    setUploadProgress(0)

    try {
      // 1. Railway에서 R2 Presigned URL 발급
      toast.info('업로드 준비 중...')
      const res = await fetch(
        `${BASE}/api/matches/${matchId}/upload-url?filename=${encodeURIComponent(file.name)}`
      )

      if (!res.ok) throw new Error('업로드 URL 발급 실패')
      const { upload_url, public_url } = await res.json()

      // 2. 브라우저 → R2 직접 업로드 (Railway 우회)
      toast.info(`업로드 중... (${(file.size / 1024 / 1024).toFixed(0)}MB)`)

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            setUploadProgress(Math.round((e.loaded / e.total) * 100))
          }
        })
        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve()
          else reject(new Error(`업로드 실패: ${xhr.status}`))
        })
        xhr.addEventListener('error', () => reject(new Error('네트워크 오류')))
        xhr.open('PUT', upload_url)
        xhr.setRequestHeader('Content-Type', 'video/mp4')
        xhr.send(file)
      })

      // 3. Railway에 URL 저장
      await fetch(`${BASE}/api/matches/${matchId}/set-video-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_url: public_url, filename: file.name }),
      })

      toast.success('영상 업로드 완료!')
      await load()

    } catch (err: any) {
      toast.error('업로드 실패: ' + (err.message ?? '다시 시도해주세요'))
    } finally {
      setUploading(false)
      setUploadProgress(0)
    }
  }

  const handleAnalyze = async (useSample: boolean) => {
    setAnalyzing(true)
    try {
      const res = await api.analyze(matchId, useSample)
      toast.success(
        !useSample && (res as any).runpod_enabled
          ? 'GPU 분석 서버 시작 중... (약 10~20분)'
          : '샘플 분석 시작!'
      )
      await load()
    } catch (err: any) {
      toast.error(err.message ?? '분석 시작 실패')
    } finally {
      setAnalyzing(false)
    }
  }

  if (loading) return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      {[1,2,3].map(i => <div key={i} className="card h-24 animate-pulse bg-gray-100 mb-4"/>)}
    </div>
  )

  if (!match) return (
    <div className="max-w-3xl mx-auto px-4 py-8 text-center text-gray-500">
      경기를 찾을 수 없습니다. <Link href="/" className="text-green-600 underline">목록으로</Link>
    </div>
  )

  const isDone = match.status === 'done'
  const isAnalyzing = match.status === 'analyzing'

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <PageHeader
        title={match.title}
        subtitle={fmtDate(match.created_at)}
        actions={
          <div className="flex gap-2">
            <Link href="/" className="btn-secondary"><ArrowLeft className="w-4 h-4"/>목록</Link>
            {isDone && (
              <Link href={`/matches/${matchId}/results`} className="btn-primary">
                <CheckCircle className="w-4 h-4"/>결과 보기
              </Link>
            )}
          </div>
        }
      />

      {/* 경기 정보 */}
      <div className="card p-5 mb-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-900">경기 정보</h2>
          <StatusBadge status={match.status}/>
        </div>
        <div className="grid grid-cols-2 gap-4 text-sm mb-4">
          <div><p className="text-gray-400 text-xs mb-1">종목</p>
            <p className="font-medium">{match.field_type === 'soccer' ? '⚽ 축구' : '🏟 풋살'}</p></div>
          <div><p className="text-gray-400 text-xs mb-1">날짜</p>
            <p className="font-medium">{match.date}</p></div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-full border" style={{background: match.home_team_color}}/>
            <span className="font-medium text-sm">{match.home_team_name}</span>
          </div>
          <span className="text-gray-400 font-bold text-xs">VS</span>
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-full border" style={{background: match.away_team_color}}/>
            <span className="font-medium text-sm">{match.away_team_name}</span>
          </div>
        </div>
      </div>

      {/* 영상 업로드 */}
      <div className="card p-5 mb-4">
        <h2 className="font-semibold text-gray-900 mb-1">영상 업로드</h2>
        <p className="text-xs text-gray-500 mb-3">
          MP4, MOV 지원 · <span className="text-green-600 font-medium">파일 크기 제한 없음</span> (Cloudflare R2 직접 업로드)
        </p>

        {match.video_filename ? (
          <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-xl">
            <CheckCircle className="w-5 h-5 text-green-600 shrink-0"/>
            <div>
              <p className="text-sm font-medium text-green-800">업로드 완료</p>
              <p className="text-xs text-green-600">{match.video_filename}</p>
            </div>
          </div>
        ) : (
          <div
            className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors
              ${uploading ? 'border-blue-300 bg-blue-50 cursor-wait' : 'border-gray-300 hover:border-green-400 cursor-pointer'}`}
            onClick={() => !uploading && fileRef.current?.click()}
          >
            {uploading ? (
              <>
                <Loader2 className="w-10 h-10 text-blue-500 mx-auto mb-3 animate-spin"/>
                <p className="font-medium text-blue-700 mb-2">업로드 중...</p>
                {uploadProgress > 0 && (
                  <>
                    <div className="w-full bg-blue-100 rounded-full h-2 mb-2">
                      <div className="bg-blue-500 h-2 rounded-full transition-all" style={{width: `${uploadProgress}%`}}/>
                    </div>
                    <p className="text-sm font-bold text-blue-700">{uploadProgress}%</p>
                  </>
                )}
              </>
            ) : (
              <>
                <Upload className="w-10 h-10 text-gray-400 mx-auto mb-3"/>
                <p className="font-medium text-gray-700 mb-1">영상 파일을 클릭해서 선택</p>
                <p className="text-xs text-gray-400">MP4, MOV · 1GB 이상도 가능</p>
              </>
            )}
            <input ref={fileRef} type="file" accept=".mp4,.mov" className="hidden" onChange={handleUpload} disabled={uploading}/>
          </div>
        )}
      </div>

      {/* 분석 시작 */}
      <div className="card p-5">
        <h2 className="font-semibold text-gray-900 mb-1">분석 시작</h2>
        <p className="text-xs text-gray-500 mb-4">영상 없이도 샘플 데이터로 즉시 분석 결과를 확인할 수 있습니다.</p>

        {isAnalyzing ? (
          <div className="flex items-center gap-3 p-4 bg-blue-50 border border-blue-200 rounded-xl">
            <Loader2 className="w-5 h-5 text-blue-600 animate-spin shrink-0"/>
            <div>
              <p className="font-medium text-blue-800 text-sm">분석 진행 중...</p>
              <p className="text-xs text-blue-600">GPU 서버 분석 중 · 완료 시 자동 이동</p>
            </div>
          </div>
        ) : isDone ? (
          <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-xl">
            <CheckCircle className="w-5 h-5 text-green-600 shrink-0"/>
            <div className="flex-1">
              <p className="font-medium text-green-800 text-sm">분석 완료!</p>
            </div>
            <Link href={`/matches/${matchId}/results`} className="btn-primary text-xs">결과 보기</Link>
          </div>
        ) : (
          <div className="space-y-3">
            <button onClick={() => handleAnalyze(true)} disabled={analyzing}
              className="w-full flex items-center gap-3 p-4 border-2 border-green-500 rounded-xl hover:bg-green-50 transition-colors text-left disabled:opacity-50">
              <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center shrink-0">
                <FlaskConical className="w-5 h-5 text-green-600"/>
              </div>
              <div>
                <p className="font-semibold text-green-700">샘플 경기 데이터로 분석</p>
                <p className="text-xs text-gray-500">영상 없이 즉시 실행 · 약 5초</p>
              </div>
              <span className="ml-auto text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">추천</span>
            </button>

            <button onClick={() => handleAnalyze(false)} disabled={analyzing || !match.video_filename}
              className="w-full flex items-center gap-3 p-4 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors text-left disabled:opacity-50">
              <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center shrink-0">
                <Play className="w-5 h-5 text-gray-600"/>
              </div>
              <div>
                <p className="font-semibold text-gray-700">실제 영상으로 GPU 분석</p>
                <p className="text-xs text-gray-500">
                  {match.video_filename ? 'YOLO AI 선수 감지 · 약 10~20분' : '먼저 영상을 업로드해주세요'}
                </p>
              </div>
              {match.video_filename && (
                <span className="ml-auto text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full shrink-0">GPU</span>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
