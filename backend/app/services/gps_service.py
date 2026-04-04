"""
GPS 데이터 파싱 및 분석 서비스
================================
지원 포맷:
  - CSV : timestamp_ms, player_id, player_name, jersey_number, lat, lng, speed_mps, team
  - JSON: 동일 필드를 가진 객체 배열
  - GPX : 표준 GPS Exchange Format (가민, 폴라, 수토 등)

주요 기능:
  - lat/lng → 경기장 정규화 좌표(0~1) 변환 (Haversine 기반)
  - 선수별 이동거리, 스프린트 횟수, 피로도 계산
  - 기존 players/frames 구조로 변환 → analysis_service와 완전 호환
"""

from __future__ import annotations

import csv
import io
import json
import math
import logging
from typing import Any, Dict, List, Optional, Tuple
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# 축구장 실제 크기 (m)
FIELD_WIDTH_M  = 105.0
FIELD_HEIGHT_M = 68.0

# 스프린트 임계값 (m/s) — 약 25km/h
SPRINT_THRESHOLD_MPS = 6.94

# GPX XML 네임스페이스
GPX_NS = {
    "gpx": "http://www.topografix.com/GPX/1/1",
    "gpx10": "http://www.topografix.com/GPX/1/0",
}


# ─────────────────────────────────────────────
# 좌표 변환 유틸
# ─────────────────────────────────────────────

def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """두 GPS 좌표 사이의 거리(미터) — Haversine 공식."""
    R = 6_371_000  # 지구 반지름 m
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def normalize_coords(
    points: List[Dict],
    ref_lat: Optional[float] = None,
    ref_lng: Optional[float] = None,
) -> List[Dict]:
    """
    lat/lng → 정규화 x/y (0~1) 변환.

    ref_lat/ref_lng 가 주어지면 해당 점을 원점으로 삼아 실제 m 단위로 변환 후
    경기장 크기(105m × 68m) 로 나눠 정규화한다.
    주어지지 않으면 bounding-box 방식으로 데이터 범위 내에서 정규화한다.
    """
    lats = [p["lat"] for p in points]
    lngs = [p["lng"] for p in points]

    if not lats:
        return points

    if ref_lat is None:
        ref_lat = min(lats)
    if ref_lng is None:
        ref_lng = min(lngs)

    # 실제 m 범위 계산
    max_x_m = haversine_m(ref_lat, ref_lng, ref_lat, max(lngs))
    max_y_m = haversine_m(ref_lat, ref_lng, max(lats), ref_lng)

    # 실제 경기장 크기로 클램프 (bounding-box가 더 크면 필드 크기 사용)
    range_x = max(max_x_m, 1.0)
    range_y = max(max_y_m, 1.0)

    for p in points:
        x_m = haversine_m(ref_lat, ref_lng, ref_lat, p["lng"])
        y_m = haversine_m(ref_lat, ref_lng, p["lat"], ref_lng)
        p["x"] = min(x_m / range_x, 1.0)
        p["y"] = min(y_m / range_y, 1.0)

    return points


# ─────────────────────────────────────────────
# 파서
# ─────────────────────────────────────────────

def _parse_csv(content: bytes) -> List[Dict]:
    text = content.decode("utf-8-sig")  # BOM 처리
    reader = csv.DictReader(io.StringIO(text))
    rows = []
    for row in reader:
        try:
            rows.append({
                "timestamp_ms":   int(float(row.get("timestamp_ms", 0))),
                "player_id":      str(row.get("player_id", "")).strip(),
                "player_name":    str(row.get("player_name", "선수")).strip(),
                "jersey_number":  int(float(row.get("jersey_number", 0) or 0)),
                "lat":            float(row["lat"]),
                "lng":            float(row["lng"]),
                "speed_mps":      float(row.get("speed_mps", 0) or 0),
                "team":           str(row.get("team", "home")).strip().lower(),
            })
        except (KeyError, ValueError) as e:
            logger.warning(f"CSV 행 파싱 실패: {e} / {row}")
    return rows


def _parse_json(content: bytes) -> List[Dict]:
    data = json.loads(content.decode("utf-8"))
    if isinstance(data, dict):
        # {"players": [...]} 형태 허용
        data = data.get("points") or data.get("data") or data.get("players") or list(data.values())[0]
    rows = []
    for item in data:
        try:
            rows.append({
                "timestamp_ms":   int(item.get("timestamp_ms", 0)),
                "player_id":      str(item.get("player_id", "")),
                "player_name":    str(item.get("player_name", "선수")),
                "jersey_number":  int(item.get("jersey_number", 0) or 0),
                "lat":            float(item["lat"]),
                "lng":            float(item["lng"]),
                "speed_mps":      float(item.get("speed_mps", 0) or 0),
                "team":           str(item.get("team", "home")).lower(),
            })
        except (KeyError, ValueError) as e:
            logger.warning(f"JSON 항목 파싱 실패: {e}")
    return rows


def _parse_gpx(content: bytes) -> List[Dict]:
    """
    GPX 포맷 파싱. 트랙이 여러 개인 경우 각 트랙을 한 선수로 간주.
    <name> 태그가 있으면 선수명/등번호 추출 시도.
    """
    root = ET.fromstring(content.decode("utf-8"))

    # 네임스페이스 자동 감지
    ns = ""
    if root.tag.startswith("{"):
        ns = root.tag.split("}")[0] + "}"

    rows = []
    player_idx = 0

    for trk in root.iter(f"{ns}trk"):
        player_idx += 1
        # 이름 파싱: "김민준 #10 home" 형태 허용
        name_el = trk.find(f"{ns}name")
        raw_name = name_el.text.strip() if (name_el is not None and name_el.text) else f"선수{player_idx}"

        jersey_number = 0
        team = "home"
        player_name = raw_name

        parts = raw_name.split()
        for part in parts:
            if part.startswith("#") and part[1:].isdigit():
                jersey_number = int(part[1:])
            elif part.lower() in ("home", "away"):
                team = part.lower()

        player_id = str(jersey_number) if jersey_number else f"gpx_{player_idx}"

        # 기준 시각 (첫 포인트 시각)
        base_time: Optional[datetime] = None

        for seg in trk.iter(f"{ns}trkseg"):
            for pt in seg.iter(f"{ns}trkpt"):
                try:
                    lat = float(pt.attrib["lat"])
                    lng = float(pt.attrib["lon"])

                    # 시각 → timestamp_ms
                    time_el = pt.find(f"{ns}time")
                    ts_ms = 0
                    if time_el is not None and time_el.text:
                        try:
                            t = datetime.fromisoformat(time_el.text.replace("Z", "+00:00"))
                            if base_time is None:
                                base_time = t
                            ts_ms = int((t - base_time).total_seconds() * 1000)
                        except ValueError:
                            pass

                    # 속도: extensions 또는 계산
                    speed_mps = 0.0
                    ext = pt.find(f"{ns}extensions")
                    if ext is not None:
                        for child in ext:
                            if "speed" in child.tag.lower() and child.text:
                                try:
                                    speed_mps = float(child.text)
                                except ValueError:
                                    pass

                    rows.append({
                        "timestamp_ms": ts_ms,
                        "player_id":    player_id,
                        "player_name":  player_name,
                        "jersey_number": jersey_number,
                        "lat": lat,
                        "lng": lng,
                        "speed_mps": speed_mps,
                        "team": team,
                    })
                except (KeyError, ValueError) as e:
                    logger.warning(f"GPX 포인트 파싱 실패: {e}")

    return rows


def parse_gps_file(filename: str, content: bytes) -> List[Dict]:
    """파일 확장자로 적절한 파서를 선택해 raw 포인트 목록 반환."""
    ext = filename.rsplit(".", 1)[-1].lower()
    if ext == "csv":
        return _parse_csv(content)
    elif ext == "json":
        return _parse_json(content)
    elif ext == "gpx":
        return _parse_gpx(content)
    else:
        raise ValueError(f"지원하지 않는 파일 형식: .{ext} (csv/json/gpx만 지원)")


# ─────────────────────────────────────────────
# 선수별 통계 계산
# ─────────────────────────────────────────────

def _calc_player_stats(
    pid: str,
    pts: List[Dict],
    match_id: int,
) -> Tuple[Dict, List[Dict]]:
    """
    단일 선수의 raw 포인트 → PlayerTrackSummary 딕셔너리 + FrameTracking 목록.
    """
    pts = sorted(pts, key=lambda p: p["timestamp_ms"])
    total_ms = pts[-1]["timestamp_ms"] if pts else 0
    half_ms  = total_ms / 2

    total_dist   = 0.0
    first_dist   = 0.0
    second_dist  = 0.0
    sprint_count = 0
    press_count  = 0

    xs = [p["x"] for p in pts]
    ys = [p["y"] for p in pts]

    prev = None
    in_sprint = False
    fatigue_acc = 0.0

    for p in pts:
        if prev is not None:
            d = haversine_m(prev["lat"], prev["lng"], p["lat"], p["lng"])
            total_dist += d
            if p["timestamp_ms"] <= half_ms:
                first_dist += d
            else:
                second_dist += d

        # 스프린트 감지
        speed = p.get("speed_mps", 0.0)
        if speed >= SPRINT_THRESHOLD_MPS:
            if not in_sprint:
                sprint_count += 1
                in_sprint = True
        else:
            in_sprint = False

        # 압박: 속도 3~6 m/s 범위 고강도 이동
        if 3.0 <= speed < SPRINT_THRESHOLD_MPS:
            press_count += 1

        fatigue_acc += speed
        prev = p

    avg_x = sum(xs) / len(xs) if xs else 0.5
    avg_y = sum(ys) / len(ys) if ys else 0.5

    # 구역 분포
    zone_left   = sum(1 for x in xs if x < 0.33) / max(len(xs), 1) * 100
    zone_center = sum(1 for x in xs if 0.33 <= x < 0.67) / max(len(xs), 1) * 100
    zone_right  = 100 - zone_left - zone_center

    # 피로도: 후반 평균속도 / 전반 평균속도 비율 역수
    first_pts  = [p for p in pts if p["timestamp_ms"] <= half_ms]
    second_pts = [p for p in pts if p["timestamp_ms"] > half_ms]
    avg_speed1 = sum(p.get("speed_mps", 0) for p in first_pts)  / max(len(first_pts), 1)
    avg_speed2 = sum(p.get("speed_mps", 0) for p in second_pts) / max(len(second_pts), 1)
    fatigue_index = round(1 - (avg_speed2 / max(avg_speed1, 0.01)), 3)
    fatigue_index = max(0.0, min(1.0, fatigue_index))

    player_name   = pts[0].get("player_name", pid)
    jersey_number = pts[0].get("jersey_number", 0)
    team_side     = pts[0].get("team", "home")

    # track_id: GPS 선수는 "gps_<jersey>" 또는 "gps_<player_id>"
    track_id = f"gps_{jersey_number}" if jersey_number else f"gps_{pid}"

    # 역할 추정
    if avg_y < 0.35:
        role_type = "수비형"
    elif avg_y > 0.65:
        role_type = "공격형"
    else:
        role_type = "중간형"

    active_area = min(len(set((round(p["x"], 1), round(p["y"], 1)) for p in pts)) / 30.0, 1.0)

    summary = {
        "match_id":               match_id,
        "track_id":               track_id,
        "team_side":              team_side,
        "total_distance_m":       round(total_dist, 2),
        "avg_position_x":         round(avg_x, 4),
        "avg_position_y":         round(avg_y, 4),
        "active_area_score":      round(active_area, 4),
        "first_half_distance_m":  round(first_dist, 2),
        "second_half_distance_m": round(second_dist, 2),
        "comment":                f"GPS #{jersey_number} {player_name}",
        "style_badge":            "GPS",
        "fatigue_index":          fatigue_index,
        "press_count":            press_count,
        "zone_left_pct":          round(zone_left, 1),
        "zone_center_pct":        round(zone_center, 1),
        "zone_right_pct":         round(zone_right, 1),
        "role_type":              role_type,
        "sprint_count":           sprint_count,
        # GPS 전용 추가 정보 (DB 컬럼 없음 → comment에 직렬화)
        "_player_name":           player_name,
        "_jersey_number":         jersey_number,
    }

    frames = [
        {
            "match_id":    match_id,
            "frame_index": i,
            "timestamp_ms": p["timestamp_ms"],
            "track_id":    track_id,
            "team_side":   team_side,
            "x":           round(p.get("x", 0.5), 4),
            "y":           round(p.get("y", 0.5), 4),
        }
        for i, p in enumerate(pts)
    ]

    return summary, frames


# ─────────────────────────────────────────────
# 퍼블릭 API
# ─────────────────────────────────────────────

def process_gps_data(
    match_id: int,
    filename: str,
    content: bytes,
) -> Dict[str, Any]:
    """
    GPS 파일 → analysis_service._save_results() 호환 딕셔너리 반환.

    Returns:
        {
            "players": [...],   # PlayerTrackSummary 딕셔너리 목록
            "frames":  [...],   # FrameTracking 딕셔너리 목록
            "preview": {...},   # 업로드 전 미리보기용 메타 정보
        }
    """
    raw_points = parse_gps_file(filename, content)
    if not raw_points:
        raise ValueError("파싱된 GPS 포인트가 없습니다.")

    # lat/lng → 정규화 좌표
    raw_points = normalize_coords(raw_points)

    # player_id 기준으로 그루핑
    grouped: Dict[str, List[Dict]] = {}
    for p in raw_points:
        pid = p["player_id"] or p.get("jersey_number") or "unknown"
        grouped.setdefault(str(pid), []).append(p)

    players, frames = [], []
    for pid, pts in grouped.items():
        summary, frame_list = _calc_player_stats(pid, pts, match_id)
        players.append(summary)
        frames.extend(frame_list)

    # 미리보기 정보
    all_ts = sorted({p["timestamp_ms"] for p in raw_points})
    duration_sec = (all_ts[-1] - all_ts[0]) / 1000 if len(all_ts) > 1 else 0
    teams = {p.get("team", "home") for p in raw_points}

    preview = {
        "total_points":  len(raw_points),
        "total_players": len(players),
        "duration_sec":  round(duration_sec, 1),
        "teams":         sorted(teams),
        "players": [
            {
                "player_id":      pid,
                "player_name":    pts[0].get("player_name", pid),
                "jersey_number":  pts[0].get("jersey_number", 0),
                "team":           pts[0].get("team", "home"),
                "point_count":    len(pts),
            }
            for pid, pts in grouped.items()
        ],
    }

    return {"players": players, "frames": frames, "preview": preview}


def get_gps_preview(filename: str, content: bytes) -> Dict[str, Any]:
    """DB 저장 없이 파일 미리보기 정보만 반환 (업로드 검증용)."""
    raw_points = parse_gps_file(filename, content)
    if not raw_points:
        return {"error": "파싱된 포인트 없음", "total_points": 0}

    grouped: Dict[str, List[Dict]] = {}
    for p in raw_points:
        pid = str(p.get("player_id") or p.get("jersey_number") or "unknown")
        grouped.setdefault(pid, []).append(p)

    all_ts = sorted({p["timestamp_ms"] for p in raw_points})
    duration_sec = (all_ts[-1] - all_ts[0]) / 1000 if len(all_ts) > 1 else 0
    teams = sorted({p.get("team", "home") for p in raw_points})

    lats = [p["lat"] for p in raw_points]
    lngs = [p["lng"] for p in raw_points]

    return {
        "total_points":  len(raw_points),
        "total_players": len(grouped),
        "duration_sec":  round(duration_sec, 1),
        "teams":         teams,
        "lat_range":     [min(lats), max(lats)],
        "lng_range":     [min(lngs), max(lngs)],
        "players": [
            {
                "player_id":     pid,
                "player_name":   pts[0].get("player_name", pid),
                "jersey_number": pts[0].get("jersey_number", 0),
                "team":          pts[0].get("team", "home"),
                "point_count":   len(pts),
                "time_range_sec": round(
                    (max(p["timestamp_ms"] for p in pts) - min(p["timestamp_ms"] for p in pts)) / 1000, 1
                ),
            }
            for pid, pts in grouped.items()
        ],
    }
