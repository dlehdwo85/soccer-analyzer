"""
선수 추적 서비스
================
등번호 없이 위치 기반 nearest-neighbor 추적.

교체 포인트:
  SimpleTracker 클래스를 ByteTrack / DeepSORT 구현으로 교체 가능.
"""

import math
from typing import Dict, List, Tuple, Optional


class Detection:
    """단일 프레임의 선수 검출 결과."""
    def __init__(self, x: float, y: float, team_side: str, confidence: float = 1.0):
        self.x = x
        self.y = y
        self.team_side = team_side
        self.confidence = confidence


class Track:
    """단일 선수 추적 트랙."""
    def __init__(self, track_id: str, det: Detection):
        self.track_id  = track_id
        self.team_side = det.team_side
        self.positions: List[Tuple[float, float]] = [(det.x, det.y)]
        self.last_x    = det.x
        self.last_y    = det.y
        self.missed    = 0          # 연속 미검출 프레임 수

    def update(self, det: Detection):
        self.last_x = det.x
        self.last_y = det.y
        self.positions.append((det.x, det.y))
        self.missed = 0

    def mark_missed(self):
        self.missed += 1


class SimpleTracker:
    """
    위치 기반 Nearest-Neighbor 트래커.

    - 각 프레임 검출 결과를 기존 트랙과 거리 기준으로 매칭
    - 매칭 임계값(max_distance) 초과 시 새 트랙 생성
    - 연속 N 프레임 미검출 트랙 제거
    """

    def __init__(self, max_distance: float = 0.15, max_missed: int = 10):
        self.tracks: Dict[str, Track] = {}
        self.next_id      = 1
        self.max_distance = max_distance
        self.max_missed   = max_missed

    def update(self, detections: List[Detection]) -> List[Tuple[str, Detection]]:
        """
        Parameters:
            detections: 현재 프레임의 검출 결과 목록

        Returns:
            [(track_id, detection), ...] 매칭 결과
        """
        active = list(self.tracks.values())
        results: List[Tuple[str, Detection]] = []
        matched_track_ids = set()
        matched_det_idxs  = set()

        # 거리 행렬 계산 → 그리디 매칭
        dists: List[Tuple[float, int, str]] = []
        for di, det in enumerate(detections):
            for track in active:
                if track.team_side != det.team_side:
                    continue
                d = math.sqrt((det.x - track.last_x)**2 + (det.y - track.last_y)**2)
                dists.append((d, di, track.track_id))

        dists.sort(key=lambda t: t[0])
        for dist, di, tid in dists:
            if di in matched_det_idxs or tid in matched_track_ids:
                continue
            if dist > self.max_distance:
                break
            track = self.tracks[tid]
            track.update(detections[di])
            results.append((tid, detections[di]))
            matched_track_ids.add(tid)
            matched_det_idxs.add(di)

        # 미매칭 검출 → 새 트랙
        for di, det in enumerate(detections):
            if di in matched_det_idxs:
                continue
            new_id = f"track_{self.next_id}"
            self.next_id += 1
            self.tracks[new_id] = Track(new_id, det)
            results.append((new_id, det))

        # 미매칭 트랙 처리
        for track in active:
            if track.track_id not in matched_track_ids:
                track.mark_missed()
                if track.missed > self.max_missed:
                    del self.tracks[track.track_id]

        return results
