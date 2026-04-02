import { useEffect, useState, useCallback } from 'react'
import { Match, MatchSummary, PlayerTrackSummary } from '@/lib/types'
import { api } from '@/lib/api'

export function useMatch(matchId: number) {
  const [match, setMatch]     = useState<Match | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.getMatch(matchId)
      setMatch(data)
    } catch (e: any) {
      setError(e.message ?? '불러오기 실패')
    } finally {
      setLoading(false)
    }
  }, [matchId])

  useEffect(() => { load() }, [load])

  return { match, loading, error, reload: load }
}

export function useMatchSummary(matchId: number) {
  const [summary, setSummary] = useState<MatchSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    api.getSummary(matchId)
      .then(setSummary)
      .catch(e => setError(e.message ?? '불러오기 실패'))
      .finally(() => setLoading(false))
  }, [matchId])

  return { summary, loading, error }
}

export function useMatchList() {
  const [matches, setMatches] = useState<Match[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.getMatches()
      setMatches(data)
    } catch (e: any) {
      setError(e.message ?? '불러오기 실패')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return { matches, loading, error, reload: load }
}
