"""
GPS 데이터 파싱 및 분석 서비스
================================
지원 포맷:
  - CSV : timestamp_ms, player_id, player_name, jersey_number, lat, lng, speed_mps, team
  - JSON: 동일 필드를 가진 객체 배열
  - GPX : 표준 GPS Exchange Format (가민, 폴라, 수토 등)

주요 기능:
  - lat/lng → 경기장 좌표(m) 변환 (로컬 투영 + 주축 정렬)
  - 영상 분석과 같은 활동량 엔진(app.vision.stats)으로 거리·속도 구간·스프린트·히트맵 계산
"""

from __future__ import annotations

import csv
import io
import json
import math
import logging
from typing import Any, Dict, List, Optional, Tuple
import xml.etree.ElementTree as ET
from datetime import datetime

logger = logging.getLogger(__name__)

# GPX XML 네임스페이스
GPX_NS = {
    "gpx": "http://www.topografix.com/GPX/1/1",
    "gpx10": "http://www.topografix.com/GPX/1/0",
}


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
# GPS → 분석 결과 (영상 분석과 같은 형식, 볼 이벤트 없음)
# ─────────────────────────────────────────────

def _project_m(points: List[Dict]) -> List[Tuple[float, float]]:
    """위경도 → 로컬 평면 좌표(m). 등장방형 투영 — 경기장 크기에서는 오차가 무시할 수준."""
    lat0 = sum(p["lat"] for p in points) / len(points)
    lng0 = sum(p["lng"] for p in points) / len(points)
    kx = 111_320.0 * math.cos(math.radians(lat0))
    ky = 110_540.0
    return [((p["lng"] - lng0) * kx, (p["lat"] - lat0) * ky) for p in points]


def _align_to_pitch(xy: List[Tuple[float, float]], length: float, width: float) -> List[Tuple[float, float]]:
    """주축(PCA)을 경기장 길이 방향으로 돌리고, 경기장 크기 안으로 옮긴다."""
    n = len(xy)
    mx = sum(x for x, _ in xy) / n
    my = sum(y for _, y in xy) / n
    sxx = sum((x - mx) ** 2 for x, _ in xy) / n
    syy = sum((y - my) ** 2 for _, y in xy) / n
    sxy = sum((x - mx) * (y - my) for x, y in xy) / n
    theta = 0.5 * math.atan2(2 * sxy, sxx - syy)
    c, s = math.cos(-theta), math.sin(-theta)
    rot = [((x - mx) * c - (y - my) * s, (x - mx) * s + (y - my) * c) for x, y in xy]
    xs = sorted(p[0] for p in rot)
    ys = sorted(p[1] for p in rot)
    # 이상치(벤치·이동 중 기록)를 빼고 1~99% 범위를 경기장 중앙에 맞춘다
    lo_x, hi_x = xs[int(0.01 * (n - 1))], xs[int(0.99 * (n - 1))]
    lo_y, hi_y = ys[int(0.01 * (n - 1))], ys[int(0.99 * (n - 1))]
    off_x = length / 2 - (lo_x + hi_x) / 2
    off_y = width / 2 - (lo_y + hi_y) / 2
    return [(x + off_x, y + off_y) for x, y in rot]


def build_gps_result(raw_points: List[Dict], field_type: str = "soccer") -> Dict[str, Any]:
    """GPS 포인트 → 분석 결과(version 2). 활동량·히트맵만 채워지고 볼 이벤트는 없다."""
    from app.vision.pitch import field_dims
    from app.vision.stats import physical_stats

    if not raw_points:
        raise ValueError("파싱된 GPS 포인트가 없습니다.")
    length, width = field_dims(field_type)
    pts = sorted(raw_points, key=lambda p: p["timestamp_ms"])
    t0 = pts[0]["timestamp_ms"]
    xy = _align_to_pitch(_project_m(pts), length, width)

    grouped: Dict[str, List[Tuple[float, float, float, float]]] = {}
    info: Dict[str, Dict] = {}
    for p, (x, y) in zip(pts, xy):
        pid = str(p.get("player_id") or p.get("jersey_number") or "unknown")
        grouped.setdefault(pid, []).append(((p["timestamp_ms"] - t0) / 1000.0, x, y, 1.0))
        info.setdefault(pid, p)

    players = []
    for pid, track in grouped.items():
        st = physical_stats(track, length, width, max_gap_s=5.0)
        p0 = info[pid]
        team = p0.get("team") if p0.get("team") in ("home", "away") else "home"
        players.append({
            "track_id": f"gps_{pid}",
            "team": team,
            "label": team,
            "color_hex": None,
            "thumbnail": None,
            "minor": False,
            "display_name": p0.get("player_name") or None,
            "jersey_number": p0.get("jersey_number") or None,
            "stats": st,
        })
    duration = (pts[-1]["timestamp_ms"] - t0) / 1000.0
    return {
        "version": 2,
        "meta": {"source": "gps", "duration_s": round(duration, 1), "calibrated": True,
                 "field": {"type": field_type, "length": length, "width": width},
                 "warnings": ["GPS 데이터에는 공 정보가 없어 볼 터치·패스·슈팅 기록은 비어 있습니다."]},
        "players": players,
        "events": [],
    }

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
