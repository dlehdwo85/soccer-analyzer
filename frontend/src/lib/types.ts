export type MatchStatus = 'created' | 'uploaded' | 'analyzing' | 'done' | 'failed'
export type FieldType = 'soccer' | 'futsal'
export type TeamSide = 'home' | 'away'
export type DataSource = 'video' | 'gps' | 'sample'

export interface Match {
  id: number
  title: string
  date: string
  field_type: FieldType
  home_team_name: string
  away_team_name: string
  home_team_color: string
  away_team_color: string
  referee_color: string
  video_filename: string | null
  status: MatchStatus
  data_source: DataSource
  created_at: string
}

// ── GPS 관련 타입 ────────────────────────────────────────────────
export interface GpsPlayerPreview {
  player_id: string
  player_name: string
  jersey_number: number
  team: string
  point_count: number
  time_range_sec: number
}

export interface GpsPreview {
  total_points: number
  total_players: number
  duration_sec: number
  teams: string[]
  lat_range: number[]
  lng_range: number[]
  players: GpsPlayerPreview[]
}

export interface GpsUploadResult {
  message: string
  total_points: number
  total_players: number
  duration_sec: number
  preview: GpsPreview
}

// ── 선수 프로필 타입 ─────────────────────────────────────────────
export interface PlayerProfile {
  id: number
  jersey_number: number
  player_name: string
  team_name: string
  total_matches: number
  total_distance_m: number
  total_sprints: number
  avg_fatigue: number
}

export interface PlayerMatchHistory {
  match_id: number
  match_title: string
  match_date: string | null
  total_distance_m: number
  sprint_count: number
  fatigue_index: number
  data_source: DataSource
}

export interface PlayerTrackSummary {
  id: number
  match_id: number
  track_id: string
  team_side: TeamSide
  total_distance_m: number
  avg_position_x: number
  avg_position_y: number
  active_area_score: number
  first_half_distance_m: number
  second_half_distance_m: number
  comment: string
  style_badge: string
  fatigue_index: number
  press_count: number
  zone_left_pct: number
  zone_center_pct: number
  zone_right_pct: number
  role_type: string
  sprint_count: number
}

export interface FramePoint {
  frame_index: number
  timestamp_ms: number
  x: number
  y: number
}

export interface PlayerDetail extends PlayerTrackSummary {
  frames: FramePoint[]
}

export interface MatchAnalytics {
  home_formation: string
  away_formation: string
  home_zone_map: string       // JSON string
  away_zone_map: string
  home_centroid_timeline: string
  away_centroid_timeline: string
  home_fatigue_timeline: string
  away_fatigue_timeline: string
  home_total_distance_m: number
  away_total_distance_m: number
  home_avg_press_dist: number
  away_avg_press_dist: number
  match_summary_text: string
}

export interface MatchSummary {
  match: Match
  players: PlayerTrackSummary[]
  home_avg_x: number
  home_avg_y: number
  away_avg_x: number
  away_avg_y: number
  total_distance_km: number
  analytics: MatchAnalytics | null
}

export interface CentroidPoint {
  time: number
  x: number
  y: number
}

export interface FatiguePoint {
  time: number
  fatigue: number
  speed: number
}
