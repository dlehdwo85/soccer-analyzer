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
  data_source: 'video' | 'gps' | 'sample' | null
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
  shots: number
  shots_on_target: number
  shots_blocked: number
  interceptions: number
  recoveries: number
  dispossessed: number
  xg: number
  distance_m: number
  walk_m: number
  jog_m: number
  run_m: number
  sprint_m: number
  sprint_count: number
  seconds_tracked: number
  top_speed_ms: number
  heat: number[]
  first_seen_s: number | null
  last_seen_s: number | null
  pass_accuracy: number | null
  avg_pass_length_m: number | null
  avg_x: number | null
  avg_y: number | null
  top_speed_kmh: number
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

export type EventKind = 'pass' | 'shot' | 'recovery'

export interface MatchEvent {
  id: number
  kind: EventKind
  t: number
  t_end: number | null
  team: Team
  player: string
  target: string | null
  x: number
  y: number
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
  shots: number
  shots_on_target: number
  shots_blocked: number
  interceptions: number
  recoveries: number
  dispossessed: number
  touches: number
  sprint_count: number
  xg: number
  distance_m: number
  sprint_m: number
  heat: number[]
}

export interface PassNetworkTeam {
  nodes: { id: string; x: number; y: number; touches: number }[]
  edges: { a: string; b: string; count: number }[]
}

export interface ResultMeta {
  source: 'video' | 'sample' | 'gps'
  sample?: boolean
  start_s?: number
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

export interface GpsPreview {
  total_points: number
  total_players: number
  duration_sec: number
  teams: string[]
  players: {
    player_id: string
    player_name: string
    jersey_number: number
    team: string
    point_count: number
    time_range_sec: number
  }[]
}

export interface ProfileTotals {
  touches: number
  passes_attempted: number
  passes_completed: number
  pass_accuracy: number | null
  shots: number
  shots_on_target: number
  xg: number
  interceptions: number
  recoveries: number
  distance_m: number
  sprint_count: number
  minutes: number
  top_speed_kmh: number
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
