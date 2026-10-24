-- schedule-manager Phase 2 — M3에서 발견한 누락 테이블
-- state.noticeActions: {noticeId, type, at} 추가 전용 로그(자체 id 없음).
-- "통보 기록은 추가만 가능합니다. 수정·삭제 기능이 없음" — 앱 자체 설계 그대로,
-- 그래서 이 테이블도 INSERT만 쓰고 PATCH/DELETE API는 만들지 않는다.
CREATE TABLE notice_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  notice_id TEXT NOT NULL,
  type TEXT NOT NULL,
  at TEXT NOT NULL,
  updated_by TEXT
);

CREATE INDEX idx_notice_actions_notice ON notice_actions(notice_id);

-- reviewRollups는 코드에 선언·초기화만 있고 실제로 채워지는 곳이 없음(2026-10-24 기준
-- 항상 빈 배열) — 별도 테이블 대신 settings에 key='reviewRollups'로 같이 둔다.
