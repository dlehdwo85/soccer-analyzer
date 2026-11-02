/** 공유 미리보기(메타데이터·OG 이미지)용 경기 요약 — 서버에서 API를 불러 만든다. 실패하면 null. */
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

export interface ShareInfo {
  title: string
  home: string
  away: string
  homeColor: string
  awayColor: string
  date: string | null
  possession: [number | null, number | null]
  passes: [string, string]
  shots: [string, string]
  /** 한 줄 요약 (AI 경기 요약이 있으면 그 첫 문장) */
  line: string | null
}

type TeamStat = { possession_pct: number | null; passes_completed: number; passes_attempted: number; shots: number; shots_on_target: number }

export async function fetchShareInfo(id: string): Promise<ShareInfo | null> {
  if (!/^\d+$/.test(id)) return null
  try {
    const res = await fetch(`${API_BASE}/api/matches/${id}/result`, { next: { revalidate: 300 } })
    if (!res.ok) return null
    const r = await res.json()
    const m = r.match, ts = r.team_stats as { home: TeamStat; away: TeamStat }
    let line: string | null = null
    const s = await fetch(`${API_BASE}/api/matches/${id}/ai-summary`, { next: { revalidate: 300 } }).catch(() => null)
    if (s?.ok) line = (await s.json()).summary?.headline ?? null
    const pct = (v: number | null) => (v == null ? null : Math.round(v))
    return {
      title: m.title, home: m.home_team_name, away: m.away_team_name,
      homeColor: m.home_team_color, awayColor: m.away_team_color, date: m.date ?? null,
      possession: [pct(ts.home.possession_pct), pct(ts.away.possession_pct)],
      passes: [`${ts.home.passes_completed}/${ts.home.passes_attempted}`, `${ts.away.passes_completed}/${ts.away.passes_attempted}`],
      shots: [`${ts.home.shots}(${ts.home.shots_on_target})`, `${ts.away.shots}(${ts.away.shots_on_target})`],
      line,
    }
  } catch {
    return null
  }
}
