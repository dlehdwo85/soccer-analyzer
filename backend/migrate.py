"""DB 마이그레이션 (수동 실행용).

앱 시작 시 자동으로 같은 작업을 하므로 보통은 필요 없다.
Railway 콘솔에서: python migrate.py

- 새 테이블 생성 (match_players, match_events 등)
- 기존 테이블에 없는 컬럼 추가 (matches.calibration_json 등)
이전 버전의 player_track_summaries / frame_trackings / match_analytics / player_profiles
테이블은 더 이상 쓰지 않으며 삭제하지 않는다.
"""

import logging

logging.basicConfig(level=logging.INFO)

if __name__ == "__main__":
    from app.database import create_tables

    create_tables()
    logging.getLogger(__name__).info("마이그레이션 완료")
