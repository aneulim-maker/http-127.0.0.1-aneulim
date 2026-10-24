-- schedule-manager Phase 2 — 초기 스키마 (M1)
-- 설계 근거: _src/schedule-manager/PHASE2_DESIGN.md 4장
-- 적용: wrangler d1 migrations apply schedule-manager-db [--local|--remote]

-- 팀원 (로그인 대상)
CREATE TABLE members (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role_title TEXT,         -- 기존 role(PM/PMO/개발자...) — 로그인 권한(auth_role)과 다른 필드
  grade TEXT,
  emp TEXT,
  org TEXT,
  rate INTEGER,             -- 개인 단가 — role=member 응답에서는 API 레이어가 제외
  skill TEXT,
  auth_role TEXT NOT NULL DEFAULT 'member',  -- 'admin' | 'member' (로그인 권한)
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT,
  client TEXT,
  color TEXT,
  start TEXT,
  end TEXT,
  status TEXT,
  kind TEXT,
  desc TEXT,
  pm_id TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  name TEXT,
  color TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

CREATE TABLE milestones (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  name TEXT,
  start TEXT,
  end TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  milestone_id TEXT,
  title TEXT,
  desc TEXT,
  assignee_id TEXT,
  category_id TEXT,
  start TEXT,
  due TEXT,
  status TEXT,
  priority TEXT,
  md REAL,
  tags_json TEXT,            -- tags[] → JSON 배열 문자열
  recurrence TEXT,
  completed_at TEXT,
  spawned INTEGER,
  executor TEXT,
  agent_spec_json TEXT,       -- agentSpec{...} 통째로 JSON
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

CREATE TABLE assignments (
  id TEXT PRIMARY KEY,
  member_id TEXT,
  project_id TEXT,
  role TEXT,
  from_ym TEXT,
  to_ym TEXT,
  alloc_json TEXT,            -- {YYYY-MM: pct} → JSON
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

-- 관리자 전용 메뉴(비용관리)의 데이터
CREATE TABLE expenses (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  date TEXT,
  category TEXT,
  amount INTEGER,
  vendor TEXT,
  status TEXT,
  vat_flag INTEGER,
  memo TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

-- 관리자 전용 메뉴(계약관리)의 데이터
CREATE TABLE contracts (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  no TEXT,
  type TEXT,
  amount INTEGER,
  vat_included INTEGER,
  mm INTEGER,
  signed TEXT,
  start TEXT,
  end TEXT,
  owner TEXT,
  warranty INTEGER,
  note TEXT,
  phases_json TEXT,           -- phases[] → JSON
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

CREATE TABLE reviews (
  id TEXT PRIMARY KEY,
  task_id TEXT,
  data_json TEXT,              -- 기존 구조 그대로 JSON 보관
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

-- 팀원 공통 권한(메뉴 아님) — 역할 구분 없이 전체 접근
CREATE TABLE notices (
  id TEXT PRIMARY KEY,
  data_json TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

-- 단일 행(키별) 설정 테이블 — rates, aiRates, aiStage, aiReinvest, aiCost,
-- aiInvoices, aiScope, reviewSlaDays, reviewRollups 등 전역 설정값.
-- rates/aiRates/aiCost/aiInvoices/aiStage/aiReinvest/aiScope 는 관리자 전용 메뉴
-- (비용관리/AI 인력산정) 소관이라 role=member 응답에서 API 레이어가 제외.
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

-- 조회 성능용 기본 인덱스 (레코드 단위 쓰기에서 project_id/assignee_id로 자주 필터링됨)
CREATE INDEX idx_tasks_project ON tasks(project_id);
CREATE INDEX idx_tasks_assignee ON tasks(assignee_id);
CREATE INDEX idx_milestones_project ON milestones(project_id);
CREATE INDEX idx_assignments_project ON assignments(project_id);
CREATE INDEX idx_assignments_member ON assignments(member_id);
CREATE INDEX idx_expenses_project ON expenses(project_id);
CREATE INDEX idx_contracts_project ON contracts(project_id);
CREATE INDEX idx_reviews_task ON reviews(task_id);
