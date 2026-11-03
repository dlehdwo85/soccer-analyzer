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
  /** 브라우저 재생용 사본 (720p H.264) — 있으면 원본 대신 재생한다 */
  web_video_url?: string | null
  status: MatchStatus
  data_source: 'video' | 'gps' | 'sample' | null  // gps는 예전 버전 데이터
  analysis_progress: number
  analysis_message: string
  analysis_error: string | null
  analysis_version: number
  calibrated: boolean
  created_at: string
  /** 등록된 팀(명단·시즌 기록)과 연결돼 있으면 그 팀 번호 */
  home_team_id?: number | null
  away_team_id?: number | null
}

export type MatchInput = Pick<Match,
  'title' | 'date' | 'field_type' | 'home_team_name' | 'away_team_name' | 'home_team_color' |
  'away_team_color' | 'referee_color' | 'home_gk_color' | 'away_gk_color' | 'home_attacks' | 'halftime_s' |
  'home_team_id' | 'away_team_id'>

export interface RosterEntry { number: number | null; name: string }

/** 등록된 팀 (명단·시즌 기록의 단위) */
export interface Club {
  id: number
  name: string
  color: string
  roster: RosterEntry[]
  match_count: number
  created_at: string
  member_count?: number
  /** 로그인한 사람의 권한 */
  my_role?: TeamRole | null
  /** 명단·팀 정보를 고칠 수 있는가 (팀원이 없는 팀은 누구나) */
  can_edit?: boolean
}

export type TeamRole = 'owner' | 'manager' | 'member'

export interface TeamMembers {
  members: { id: number; nickname: string | null; profile_image: string | null; role: TeamRole }[]
  my_role: TeamRole | null
  /** 운영진(팀원이 없는 팀이면 로그인한 누구나)에게만 보인다 */
  invite_code: string | null
}

export interface ClubInput { name: string; color: string; roster: RosterEntry[] }

export interface SeasonPlayer {
  name: string
  number: number | null
  in_roster: boolean
  matches: number
  goals: number
  minutes: number
  touches: number
  passes_attempted: number
  passes_completed: number
  pass_accuracy: number | null
  key_passes: number
  forward_passes: number
  shots: number
  shots_on_target: number
  xg: number
  interceptions: number
  recoveries: number
  dispossessed: number
}

export interface Season {
  team: Club
  year: number | null
  record: { played: number; scored_known: number; win: number; draw: number; loss: number; goals_for: number; goals_against: number }
  matches: { match_id: number; title: string; date: string | null; side: Team; opponent: string;
             score: [number, number] | null; possession_pct: number | null }[]
  players: SeasonPlayer[]
}

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
  /** AI 분석을 만든 시각 (없으면 null) */
  ai_report_at?: string | null
  /** AI 분석 뒤 기록이 바뀌었으면 true, 분석이 없으면 null */
  ai_report_stale?: boolean | null
}

/** AI 선수 분석 본문 — 기록된 수치·이벤트만 근거로 만든다 */
export interface AIPlayerReport {
  summary: string
  /** 1~10, 데이터가 부족하면 null (판단 보류) */
  rating: number | null
  strengths: string[]
  improvements: string[]
  next_match_tips: string[]
  data_caveats: string[]
}

/** GET/POST /api/matches/{id}/players/{track_id}/ai-report — 전체 경기 기록 기준 */
export interface PlayerReport {
  /** 병합 대표 트랙 */
  track_id: string
  report: AIPlayerReport
  model: string
  usage: { input_tokens: number; output_tokens: number }
  generated_at: string
  /** 분석 뒤 기록(이벤트 검수·트랙 병합 등)이 바뀌었으면 true */
  stale: boolean
}

/** GET/POST /api/matches/{id}/ai-summary — 무엇이 승부를 갈랐나 + MOM 후보 */
export interface MatchSummary {
  summary: {
    headline: string
    key_points: string[]
    /** 앞에서부터 추천 순 */
    mom: { track_id: string; reason: string }[]
    data_caveats: string[]
  }
  model: string
  usage: { input_tokens: number; output_tokens: number }
  generated_at: string
  stale: boolean
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
  /** 화면 밖에 있다 돌아와 따로 잡힌 같은 선수 후보 (트랙 → 가까운 순 후보 트랙) */
  merge_hints?: Record<string, string[]>
  /** 영상에 박힌 점수 자막에서 읽은 골 (자막이 바뀐 시각, 직전 슈팅이 있으면 그 시각·선수) */
  scoreboard?: {
    found: boolean
    goals?: { t: number; t_board: number; team: Team; side: 'left' | 'right'; player: string | null }[]
    score?: Record<Team, number>
  }
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

/** 영상 검수용 선수 박스 한 행: [분석 프레임 번호, x1, y1, x2, y2] (원본 영상 픽셀) */
export type OverlayBox = [k: number, x1: number, y1: number, x2: number, y2: number]
/** 공 위치 한 행: [분석 프레임 번호, x, y, 검출 여부(1) / 보간(0)] */
export type OverlayBall = [k: number, x: number, y: number, detected: 0 | 1]

/** GET /api/matches/{id}/overlay — 프레임 k의 영상 시각 = start_s + k * step (원본 영상 기준 초) */
export interface Overlay {
  v: number
  /** 원본 영상 프레임 크기(픽셀) */
  w: number
  h: number
  start_s: number
  step: number
  n: number
  /** track_id → 프레임 순으로 정렬된 박스 (추적된 프레임에만 있다) */
  tracks: Record<string, OverlayBox[]>
  ball: OverlayBall[]
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
