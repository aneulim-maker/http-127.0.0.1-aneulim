-- 로그인 계정(admin/member 등)이 "시연 데이터 초기화"에 휩쓸려 삭제되지 않도록
-- 보존 대상임을 표시하는 플래그. 기본값 0(=데모 리셋 때 같이 교체됨).
ALTER TABLE members ADD COLUMN keep_on_reset INTEGER NOT NULL DEFAULT 0;
