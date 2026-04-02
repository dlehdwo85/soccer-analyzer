"""
색상 기반 팀 분류 서비스
========================
bounding box 내부 픽셀의 HSV 색상을 사용자가 지정한 팀 색상과 비교하여
홈/원정을 분류합니다.

교체 포인트:
  classify_team_by_color() 함수만 실제 CV 구현으로 교체하면 됩니다.
"""

import math
from typing import Tuple


def hex_to_rgb(hex_color: str) -> Tuple[int, int, int]:
    h = hex_color.lstrip('#')
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))  # type: ignore


def rgb_to_hsv(r: int, g: int, b: int) -> Tuple[float, float, float]:
    r_, g_, b_ = r / 255.0, g / 255.0, b / 255.0
    cmax = max(r_, g_, b_)
    cmin = min(r_, g_, b_)
    diff = cmax - cmin

    if diff == 0:
        h = 0.0
    elif cmax == r_:
        h = (60 * ((g_ - b_) / diff) % 360)
    elif cmax == g_:
        h = 60 * ((b_ - r_) / diff) + 120
    else:
        h = 60 * ((r_ - g_) / diff) + 240

    s = 0.0 if cmax == 0 else diff / cmax
    v = cmax
    return h, s, v


def color_distance(hex1: str, hex2: str) -> float:
    """두 HEX 색상 간 RGB 유클리드 거리."""
    r1, g1, b1 = hex_to_rgb(hex1)
    r2, g2, b2 = hex_to_rgb(hex2)
    return math.sqrt((r1-r2)**2 + (g1-g2)**2 + (b1-b2)**2)


def classify_team_by_color(
    pixel_color: str,          # 감지된 선수 색상 HEX
    home_color: str,           # 홈팀 색상 HEX
    away_color: str,           # 원정팀 색상 HEX
) -> str:
    """
    픽셀 색상이 홈/원정 중 어느 팀에 가까운지 판별.

    실제 영상 분석 시:
      pixel_color = bounding box 내 중심부 픽셀 평균 색상
    """
    d_home = color_distance(pixel_color, home_color)
    d_away = color_distance(pixel_color, away_color)
    return "home" if d_home <= d_away else "away"
