export type MatchStatus = 'created' | 'uploaded' | 'analyzing' | 'done' | 'failed'
export type FieldType = 'soccer' | 'futsal'
export type TeamSide = 'home' | 'away'

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
  created_at: string
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
