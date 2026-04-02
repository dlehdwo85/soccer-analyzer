export type MatchStatus = 'created' | 'uploaded' | 'analyzing' | 'done' | 'failed'
export type FieldType   = 'soccer' | 'futsal'
export type TeamSide    = 'home' | 'away'

export interface Match {
  id: number
  title: string
  date: string
  field_type: FieldType
  home_team_name: string
  away_team_name: string
  home_team_color: string
  away_team_color: string
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

export interface MatchSummary {
  match: Match
  players: PlayerTrackSummary[]
  home_avg_x: number
  home_avg_y: number
  away_avg_x: number
  away_avg_y: number
  total_distance_km: number
}
