"""로컬에서 돌린 분석 결과(JSON)를 DB의 경기에 저장한다.

서버에 분석 엔진이 없거나 느릴 때, 이 컴퓨터에서 app.vision.pipeline.analyze_video 로 만든 결과를
그대로 사이트에 올리는 용도. 경기가 없으면 만들고, 있으면 결과만 덮어쓴다.

사용 (backend/ 에서, DATABASE_URL 환경변수 필요):
  python import_result.py result.json --title "26년 3월 29일 VS 북수 3쿼터" --date 2026-03-29 \
      --home 월넛FC --away 북수 --home-color "#4fc3f7" --away-color "#f0446c" --referee-color "#c6f135" \
      --video-url https://pub-xxxx.r2.dev/matches/1/영상.mp4 [--match-id 3]
"""
import argparse
import json
import sys

from app.database import SessionLocal, create_tables
from app.models import Match
from app.services.result_service import save_result


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("result_json")
    ap.add_argument("--match-id", type=int)
    ap.add_argument("--title")
    ap.add_argument("--date")
    ap.add_argument("--home", default="홈팀")
    ap.add_argument("--away", default="원정팀")
    ap.add_argument("--home-color", default="#56b4d3")
    ap.add_argument("--away-color", default="#ef4444")
    ap.add_argument("--referee-color", default="#facc15")
    ap.add_argument("--video-url")
    ap.add_argument("--video-filename")
    a = ap.parse_args()

    with open(a.result_json, encoding="utf-8") as f:
        result = json.load(f)

    create_tables()
    db = SessionLocal()
    try:
        m = db.get(Match, a.match_id) if a.match_id else None
        if m is None:
            if not a.title:
                print("새 경기를 만들려면 --title 이 필요합니다", file=sys.stderr)
                return 2
            m = Match(title=a.title)
            db.add(m)
            db.flush()
        for field, val in (("title", a.title), ("date", a.date), ("home_team_name", a.home), ("away_team_name", a.away),
                           ("home_team_color", a.home_color), ("away_team_color", a.away_color),
                           ("referee_color", a.referee_color), ("video_url", a.video_url),
                           ("video_filename", a.video_filename)):
            if val:
                setattr(m, field, val)
        save_result(db, m, result, "video")
        db.commit()
        print(f"저장 완료: match_id={m.id} 선수 {len(result.get('players', []))}명, 이벤트 {len(result.get('events', []))}개")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
