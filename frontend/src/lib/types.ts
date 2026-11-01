export type MatchStatus = 'created' | 'uploaded' | 'analyzing' | 'done' | 'failed'
export type FieldType = 'soccer' | 'futsal'
export type Team = 'home' | 'away'
export type AttackSide = 'auto' | 'right' | 'left'

export interface Match {
  id: number
  title: string
  date: string | null
  field_type: FieldType
  home_team_name: string
  away_team_name: string
  home_team_color: string
  away_team_color: string
  referee_color: string | null
  home_gk_color: string | null
  away_gk_color: string | null
  home_attacks: AttackSide
  halftime_s: number | null
  video_filename: string | null
  video_url: string | null
  status: MatchStatus
  data_source: 'video' | 'gps' | 'sample' | null  // gps는 예전 버전 데이터
  analysis_progress: number
  analysis_message: string
  analysis_error: string | null
  analysis_version: number
  calibrated: boolean
  created_at: string
}

export type MatchInput = Pick<Match,
  'title' | 'date' | 'field_type' | 'home_team_name' | 'away_team_name' | 'home_team_color' |
  'away_team_color' | 'referee_color' | 'home_gk_color' | 'away_gk_color' | 'home_attacks' | 'halftime_s'>

export interface AnalysisStatus {
  status: MatchStatus
  progress: number
  message: string
  error: string | null
  has_result: boolean
}

export interface PlayerStats {
  touches: number
  possession_s: number
  passes_attempted: number
  passes_completed: number
  passes_failed: number
  passes_received: number
  forward_passes: number
  key_passes: number
  shots: number
  shots_on_target: number
  shots_blocked: number
  interceptions: number
  recoveries: number
  dispossessed: number
  xg: number
  seconds_tracked: number
  first_seen_s: number | null
  last_seen_s: number | null
  pass_accuracy: number | null
  avg_pass_length_m: number | null
  avg_x: number | null
  avg_y: number | null
  minutes_tracked: number
}

export interface PlayerRow {
  track_id: string
  team: Team
  label: string
  color_hex: string | null
  has_thumbnail: boolean
  minor: boolean
  excluded: boolean
  display_name: string | null
  jersey_number: number | null
  merged_from: string[]
  stats: PlayerStats
}

export type EventKind = 'pass' | 'shot' | 'recovery' | 'set_piece'
/** 세트피스 종류 — 경기장 지정(보정)이 있을 때만 나뉘고, 없으면 'restart' */
export type SetPieceType = 'corner' | 'free_kick' | 'throw_in' | 'goal_kick' | 'kick_off' | 'restart'
export const SET_PIECE_LABEL: Record<SetPieceType, string> = {
  corner: '코너킥', free_kick: '프리킥', throw_in: '스로인', goal_kick: '골킥', kick_off: '킥오프', restart: '재개',
}

export interface MatchEvent {
  id: number
  manual: boolean
  edited: boolean
  kind: EventKind
  t: number
  t_end: number | null
  team: Team
  player: string
  target: string | null
  x: number | null
  y: number | null
  x2: number | null
  y2: number | null
  success: boolean | null
  detail: {
    reason?: 'completed' | 'intercepted' | 'out' | 'lost'
    length_m?: number
    forward?: boolean
    outcome?: 'on_target' | 'off_target' | 'blocked'
    speed_ms?: number
    xg?: number
  }
}

export interface TeamStats {
  possession_pct: number | null
  possession_s: number
  players: number
  passes_attempted: number
  passes_completed: number
  passes_failed: number
  pass_accuracy: number | null
  forward_passes: number
  key_passes: number
  shots: number
  shots_on_target: number
  shots_blocked: number
  interceptions: number
  recoveries: number
  dispossessed: number
  touches: number
  xg: number
  set_pieces: number
  corners: number
  free_kicks: number
  throw_ins: number
  goal_kicks: number
  kick_offs: number
}

export interface PassNetworkTeam {
  nodes: { id: string; x: number; y: number; touches: number }[]
  edges: { a: string; b: string; count: number }[]
}

export interface ResultMeta {
  source: 'video' | 'sample' | 'gps'
  sample?: boolean
  start_s?: number
  halftime_rel_s?: number | null
  duration_s: number
  fps_video?: number
  analysis_fps?: number
  calibrated: boolean
  ball_detected_pct?: number | null
  raw_tracks?: number
  warnings: string[]
  field: { type: FieldType; length: number; width: number }
  attack?: { first: Record<Team, number>; second: Record<Team, number> }
  snapped_colors?: Record<string, string>
}

export interface MatchResult {
  version: number
  match: Match
  meta: ResultMeta
  period: 1 | 2 | null
  players: PlayerRow[]
  events: MatchEvent[]
  /** [시작, 끝, 팀, 선수] */
  possessions: [number, number, Team, string][]
  team_stats: Record<Team, TeamStats>
  pass_network: Record<Team, PassNetworkTeam>
  possession_timeline: { start_s: number; end_s: number; home_pct: number | null }[]
}

export interface CalibrationInput {
  preset: 'full' | 'left_half' | 'right_half'
  image_points: [number, number][]
  length?: number
  width?: number
}

export interface Calibration extends CalibrationInput {
  pitch_points: [number, number][]
  length: number
  width: number
}

export interface ProfileTotals {
  touches: number
  passes_attempted: number
  passes_completed: number
  passes_failed: number
  forward_passes: number
  key_passes: number
  pass_accuracy: number | null
  shots: number
  shots_on_target: number
  xg: number
  interceptions: number
  recoveries: number
  dispossessed: number
  minutes: number
}

export interface PlayerProfile {
  name: string
  jersey_number: number | null
  match_count: number
  totals: ProfileTotals
}

export interface PlayerProfileDetail extends PlayerProfile {
  matches: {
    match_id: number
    title: string
    date: string | null
    data_source: string | null
    team_name: string
    track_id: string
    stats: Partial<PlayerStats>
  }[]
}

export interface Health {
  status: string
  version: string
  engines: { runpod: boolean; local: boolean }
  r2: boolean
}

export type EventResult = 'completed' | 'intercepted' | 'out' | 'on_target' | 'off_target' | 'blocked'

export interface EventPatch {
  player?: string
  target?: string | null
  result?: EventResult
  t?: number
  deleted?: boolean
}

export interface EventCreate {
  kind: EventKind
  t: number
  player: string
  target?: string | null
  result?: EventResult
}

export interface VideoLibrary {
  storage: boolean
  matches: {
    match_id: number
    title: string
    date: string | null
    video_filename: string | null
    video_url: string
    status: MatchStatus
    analysis_version: number
    data_source: string | null
    needs_analysis: boolean
  }[]
  orphans: { key: string; filename: string; url: string; size_mb: number; last_modified: string | null }[]
}

/** 경기장 위치가 있는 이벤트 (직접 추가한 이벤트는 위치가 없다) */
export type PlacedEvent = MatchEvent & { x: number; y: number }
export const isPlaced = (e: MatchEvent): e is PlacedEvent => e.x !== null && e.y !== null
