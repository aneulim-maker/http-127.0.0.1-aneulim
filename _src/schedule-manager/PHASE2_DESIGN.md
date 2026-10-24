# schedule-manager — Phase 2 설계: 로그인 · 권한 · 다중 사용자 동기화

최종 갱신: 2026-10-24
상태: **설계 문서 — 구현 전** (권한 모델 전부 확정, 남은 미결 2건 확인 후 M1부터 착수)
연관 문서: [DEV_PLAN.md](DEV_PLAN.md)

---

## 0. 왜 이 문서가 필요한가

Phase 2는 처음엔 "기기 간 동기화(Workers + D1/KV)" 정도로 가볍게 잡았지만, 실제로는 **"2~5명이 동시에 쓰고, 같은 과업을 가끔 동시에 수정"**하는 게 확인됐다. 지금 구조(로그인 없음, 전체 state를 통째로 `localStorage`에 저장)에 그대로 "동기화"만 얹으면 두 사람이 비슷한 시점에 저장할 때 한쪽 작업이 통째로 사라진다(마지막 저장만 승리). 그래서 로그인·권한·레코드 단위 저장까지 묶어서 다시 설계한다.

**확정된 요구사항** (대화에서 확인됨):
- 동시 사용자: 2~5명
- 동시 편집(같은 레코드) 빈도: 가끔 있음 → 레코드 단위 저장 + 최소한의 충돌 감지 필요
- 로그인: 이름 선택(드롭다운) + 팀 공용 비밀번호
- 권한: 관리자(전체) / 팀원(일반 업무 — **정산·비용 제외**)

---

## 1. 권한 모델

### 1.1 확정 (2026-10-24 전부 확정됨)

| 영역 | 관리자 | 팀원 |
|---|---|---|
| 인력관리·일정(gantt)·업무보드(kanban)·에이전트 과업(agentops)·달력 | ✅ | ✅ |
| **계약관리(contract)** | ✅ | ❌ — 계약금액·지급조건 포함이라 admin 전용으로 변경 |
| 정산관리(settlement) | ✅ | ❌ |
| 비용관리(cost) | ✅ | ❌ |
| **대시보드의 재무 카드**("AI 순 원가 영향"·"영업이익" 등) | ✅ | ❌ — 카드 단위로 숨김, 나머지 운영 지표 카드는 공개 |
| **AI 인력산정(aisim) — 공수/스태핑 요소**(시뮬레이션 조건, 공수 차트, 공수 KPI, 표의 공수 컬럼) | ✅ | ✅ |
| **AI 인력산정(aisim) — 금액 요소**(인건비 영향 카드·컬럼, 비용 차트, 월별 AI 비용 카드/표) | ✅ | ❌ |
| **알림함(notices)** | ✅ | ✅ — 팀원 공통 권한, 지금처럼 전역 공유 구조 그대로(제한 없음) |
| 로그인 | 이름 선택 + 팀 공용 비밀번호 (동일) | |

### 1.2 AI 인력산정 — 필드 단위 분리가 필요한 이유
`renderAiSim()`을 확인한 결과, 이 화면은 섹션 단위로 깔끔히 안 나뉘고 **같은 카드·같은 표 안에서 공수(M/M)와 금액이 한 줄에 같이 나온다**:
- 완전히 공수만: 시뮬레이션 조건 설정 카드, "직무별 공수 변화(M/M)" 차트
- 금액이 섞인 부분: KPI 카드 4개 중 "인건비 영향"·"인원 환산(FTE)" 카드, "직무별 산정 명세" 표의 "인건비 영향" 컬럼, "직무별 인건비 절감" 차트, "월별 AI 비용" 카드/표

→ 메뉴 전체를 숨기는 게 아니라 **카드·컬럼 단위**로 숨겨야 해서, 다른 영역(메뉴 통째 숨김)보다 프론트 작업이 더 든다. M5에 반영(10장 참고).

---

## 2. 데이터 분류 — 동기화 대상 vs 로컬 전용

`state`의 모든 필드를 서버에 올릴 필요는 없다. **여러 사람이 공유해야 하는 업무 데이터**만 동기화하고, **그 사람의 화면 상태**는 지금처럼 `localStorage`에 남긴다.

| 분류 | 필드 | 처리 |
|---|---|---|
| 동기화(공유) | `projects`, `contracts`, `milestones`, `tasks`, `members`, `categories`, `assignments`, `expenses`, `reviews`, `reviewRollups`, `notices`, `noticeActions`, `rates`, `aiRates`, `aiStage`, `aiReinvest`, `aiCost`, `aiInvoices`, `aiScope`, `reviewSlaDays` | D1로 이전, API로 읽기/쓰기 |
| 로컬 전용(개인 화면 상태) | `view`, `peopleTab`, `settleTab`, `costTab`, `calendarYear`, `calendarMonth`, `ganttZoom`, `periodYear`, `periodMonth`, `reportPeriod`, `reportStart`, `reportEnd`, `selectedProjectId` | 지금처럼 `localStorage`(기기별) 유지, 동기화 안 함 |

---

## 3. 인증 설계

### 3.1 로그인 흐름
1. 관리자가 "인력관리" 로스터(기존 `members` 테이블)에 **역할(admin/member)** 필드를 추가해 팀원마다 지정.
2. 로그인 화면: `members` 목록에서 이름 선택 + 팀 공용 비밀번호 입력 → `POST /api/login`.
3. 서버: 비밀번호를 Workers Secret(`TEAM_PASSWORD`, 평문 비교 또는 해시 비교)과 대조. 맞으면 해당 `memberId` + `role`을 담은 **서명된 세션 쿠키** 발급(httpOnly, Secure, SameSite=Lax).
4. 이후 모든 `/api/*` 요청은 쿠키의 서명을 검증해 `memberId`/`role`을 식별. 세션 테이블 없이 **무상태(stateless) 서명 토큰**으로 처리(소규모라 세션 저장소 불필요).
5. 로그아웃: 쿠키 삭제.

### 3.2 왜 이 방식인가
- 비밀번호 1개 + 이름 선택 — 사람별 계정 발급/비밀번호 분실 대응 같은 관리 부담이 없음(2~5명 규모에 적합).
- 세션을 서명된 쿠키로만 처리 → DB에 세션 테이블 불필요, 서버 재시작/스케일에도 영향 없음.
- 비밀번호·서명 키는 `wrangler secret put`으로 등록 — 저장소에는 절대 평문으로 들어가지 않음(기존 `.assetsignore`·보안 원칙과 일치).

### 3.3 세션 만료
- 기본 30일(소규모 신뢰 팀 도구 기준). 필요하면 조정 가능.

---

## 4. 데이터베이스 스키마 (Cloudflare D1 / SQLite)

기존 `state`의 실제 레코드 형태(코드의 `seed()` 기준)를 그대로 테이블로 옮긴다. 중첩 구조(`agentSpec`, `phases`, `alloc`, `tags`, `history`)는 정규화 대신 **JSON 컬럼**으로 저장해 프론트엔드 변경 폭을 최소화한다(이미 중첩 객체를 다루는 렌더링 코드를 그대로 재사용하기 위함).

```sql
-- 팀원 (로그인 대상)
CREATE TABLE members (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role_title TEXT,         -- 기존 role(PM/PMO/개발자...) — 로그인 role과 다른 필드
  grade TEXT, emp TEXT, org TEXT, rate INTEGER, skill TEXT,
  auth_role TEXT NOT NULL DEFAULT 'member',  -- 'admin' | 'member' (로그인 권한)
  updated_at TEXT NOT NULL, updated_by TEXT
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY, name TEXT, client TEXT, color TEXT,
  start TEXT, end TEXT, status TEXT, kind TEXT, desc TEXT, pm_id TEXT,
  updated_at TEXT NOT NULL, updated_by TEXT
);

CREATE TABLE categories (
  id TEXT PRIMARY KEY, name TEXT, color TEXT,
  updated_at TEXT NOT NULL, updated_by TEXT
);

CREATE TABLE milestones (
  id TEXT PRIMARY KEY, project_id TEXT, name TEXT, start TEXT, end TEXT,
  updated_at TEXT NOT NULL, updated_by TEXT
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY, project_id TEXT, milestone_id TEXT, title TEXT, desc TEXT,
  assignee_id TEXT, category_id TEXT, start TEXT, due TEXT, status TEXT,
  priority TEXT, md REAL, tags_json TEXT,            -- tags[] → JSON 배열 문자열
  recurrence TEXT, completed_at TEXT, spawned INTEGER,
  executor TEXT, agent_spec_json TEXT,                -- agentSpec{...} 통째로 JSON
  updated_at TEXT NOT NULL, updated_by TEXT
);

CREATE TABLE assignments (
  id TEXT PRIMARY KEY, member_id TEXT, project_id TEXT, role TEXT,
  from_ym TEXT, to_ym TEXT, alloc_json TEXT,          -- {YYYY-MM: pct} → JSON
  updated_at TEXT NOT NULL, updated_by TEXT
);

CREATE TABLE expenses (                                -- 관리자 전용
  id TEXT PRIMARY KEY, project_id TEXT, date TEXT, category TEXT,
  amount INTEGER, vendor TEXT, status TEXT, vat_flag INTEGER, memo TEXT,
  updated_at TEXT NOT NULL, updated_by TEXT
);

CREATE TABLE contracts (
  id TEXT PRIMARY KEY, project_id TEXT, no TEXT, type TEXT, amount INTEGER,
  vat_included INTEGER, mm INTEGER, signed TEXT, start TEXT, end TEXT,
  owner TEXT, warranty INTEGER, note TEXT, phases_json TEXT,  -- phases[] → JSON
  updated_at TEXT NOT NULL, updated_by TEXT
);

CREATE TABLE reviews (
  id TEXT PRIMARY KEY, task_id TEXT, data_json TEXT,   -- 기존 구조 그대로 JSON 보관
  updated_at TEXT NOT NULL, updated_by TEXT
);

CREATE TABLE notices (
  id TEXT PRIMARY KEY, data_json TEXT,
  updated_at TEXT NOT NULL, updated_by TEXT
);

-- 단일 행 설정 테이블 (rates, aiRates, aiStage 등 전역 설정값)
CREATE TABLE settings (
  key TEXT PRIMARY KEY,   -- 'rates' | 'aiRates' | 'aiStage' | 'aiCost' | ...
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL, updated_by TEXT
);
```

모든 테이블에 `updated_at`(ISO 시각) + `updated_by`(memberId)를 둬서 — ① 누가 언제 고쳤는지 추적, ② 아래 5장의 **낙관적 동시성 체크**에 사용.

---

## 5. API 설계

Worker에 `/api/*` 라우트 추가 (정적 자산 서빙은 그대로 유지).

### 5.1 인증
- `POST /api/login` `{name, password}` → 세션 쿠키 설정, `{ok, memberId, name, role}` 반환
- `POST /api/logout` → 쿠키 제거

### 5.2 읽기 (1단계는 통짜 조회로 단순화)
- `GET /api/state` → 모든 동기화 대상 테이블을 한 번에 모아서 기존 `state`와 같은 모양(JSON)으로 반환. **프론트엔드의 렌더링 코드는 거의 그대로 재사용** 가능(어차피 지금도 메모리의 `state` 객체 하나를 보고 그림).
  - `role=member`면 `expenses`, `contracts`, 비용 관련 `settings` 키(`aiCost`, `aiInvoices` 등)는 응답에서 제외(서버에서 필터링 — 프론트가 숨기는 것만으론 부족, 네트워크 응답 자체에서 차단).
  - `tasks`의 AI 인력산정 관련 금액 필드(과업 자체가 아니라 aisim 계산에 쓰이는 `rates`/`aiRates`의 "단가" 값)도 `role=member`면 응답에서 제외하거나 마스킹 — aisim 화면의 금액 카드/컬럼이 애초에 그 값을 못 받게 함(프론트에서 숨기는 것보다 안전).
  - `notices`는 역할 구분 없이 그대로 전부 반환(팀원 공통 권한, 1.1 참고).

### 5.3 쓰기 (레코드 단위 — 핵심 변경점)
엔티티별 CRUD, 예시(`tasks` 기준, 나머지도 동일 패턴):
- `POST /api/tasks` — 생성
- `PATCH /api/tasks/:id` `{..변경필드, ifUpdatedAt}` — 수정. **`ifUpdatedAt`이 서버의 현재 `updated_at`과 다르면 409 Conflict** 반환(다른 사람이 먼저 고침)
- `DELETE /api/tasks/:id`

`expenses`, `contracts`, `settings`(비용/정산 관련 키)의 쓰기 엔드포인트는 `role=admin`만 허용(403). `notices`는 모든 role이 쓰기 가능(기존 동작 그대로).

### 5.4 마이그레이션(1회성)
- `POST /api/migrate` `{json}` — 기존 `exportData()`로 뽑은 JSON 백업을 그대로 붙여넣어 D1에 일괄 적재(최초 1회, admin만).

---

## 6. 동시편집 충돌 처리

"가끔" 발생하는 수준이므로 **단순한 낙관적 동시성 제어(Optimistic Concurrency)**로 충분하다고 판단:

1. 프론트는 레코드를 불러올 때 그 레코드의 `updatedAt`을 같이 기억해 둔다.
2. 수정해서 `PATCH`할 때 그 `updatedAt`을 `ifUpdatedAt`으로 같이 보낸다.
3. 서버는 지금 DB의 `updated_at`과 비교 — 같으면 저장하고 새 `updated_at` 반환, **다르면 409**.
4. 프론트는 409를 받으면 "방금 다른 사람이 이 항목을 수정했습니다. 최신 내용을 불러올까요?" 토스트/확인창 → 확인 시 해당 레코드만 다시 불러와 덮어쓰기 제안(필요하면 두 값을 보여주고 사용자가 선택).

실시간 동기화(WebSocket·Durable Objects)는 지금 범위에 넣지 않는다 — "가끔" 수준 충돌엔 과한 복잡도. 대신 **주기적 새로고침(폴링, 예: 30초)**으로 다른 사람의 변경을 반영한다. 필요성이 커지면 나중에 업그레이드 가능(8장 참고).

---

## 7. 프론트엔드 변경

- **로그인 화면**: 세션 쿠키 없으면 로그인 오버레이 표시. (`app.html` 상단에 체크 로직 추가)
- **`load()`**: `localStorage`에서 읽던 걸 `GET /api/state` 호출로 교체(UI 전용 필드는 기존처럼 `localStorage`에서).
- **`save()`**: 지금처럼 "전체를 한 번에 저장"하는 범용 함수는 유지하기 어려움 — 각 변경 지점(현재 `save()` 호출 43곳)에서 **무엇이 바뀌었는지**가 이미 그 함수 안에 있으므로, 거기서 바로 해당 레코드의 API를 호출하도록 하나씩 바꾼다. (기계적이지만 손이 많이 가는 작업 — 아래 M4 참고)
- **권한에 따른 UI 숨김**: 로그인 응답의 `role`을 전역에 저장해 두고, `role==='member'`일 때 — ① 정산/비용/계약관리 메뉴 자체를 숨김(메뉴 단위), ② 대시보드의 재무 카드를 숨김(카드 단위), ③ `renderAiSim()`의 `aiKpiHtml`/`aiTableHtml`/`aiCostCardHtml`/`aiCostKpiHtml`/`aiCostTableHtml`과 "직무별 인건비 절감" 차트에서 금액 관련 카드·컬럼·차트만 숨김(필드 단위 — 1.2 참고). 알림함은 그대로 전체 공개.
- **주기적 새로고침**: `setInterval`로 30초마다 `GET /api/state` 재호출 + 재렌더링(이미 있는 `checkReminders`의 60초 인터벌과 같은 패턴).

---

## 8. 인프라 변경

| 항목 | 지금 | 변경 후 |
|---|---|---|
| `wrangler.jsonc` | `assets`만 있는 정적 전용 Worker | 정적 자산 서빙 + `/api/*` 처리하는 **Worker 코드**(`main` 추가) + **D1 바인딩** |
| 비밀값 | 없음 | `wrangler secret put TEAM_PASSWORD`, `wrangler secret put SESSION_SECRET`(서명용) |
| 데이터베이스 | 없음(브라우저 localStorage뿐) | `wrangler d1 create schedule-manager-db` + 마이그레이션 SQL |

배포 자체는 사용자 Cloudflare 계정 인증이 필요해 **제가 혼자 실행할 수 없고, 로컬에서 같이 `wrangler login` 후 진행**해야 함(지난번 git push 때와 동일한 제약).

---

## 9. 마이그레이션 계획

1. 관리자가 기존(현재 쓰던) 브라우저에서 `exportData()`로 JSON 백업을 받는다. (이미 Phase 1에서 만든 기능 재사용)
2. 새 로그인·D1 버전 배포 후, 관리자가 로그인 → "초기 데이터 가져오기" 화면에서 그 JSON을 `POST /api/migrate`로 올린다.
3. D1에 일괄 적재되면, 이후부터는 모두가 이 D1을 기준으로 본다. 각자의 기존 localStorage 데이터는 더 이상 쓰지 않음(개인 UI 상태만 남김).

---

## 10. 단계별 실행 계획

큰 작업이라 한 번에 끝내지 않고 마일스톤으로 쪼갠다. **M3까지만 해도 지금의 가장 큰 위험(동시 저장 시 전체 덮어쓰기)이 사라진다** — 그래서 M3를 중간 목표로 둔다.

| 단계 | 내용 | 비고 |
|---|---|---|
| M1 | D1 스키마 생성 + Worker 라우팅 뼈대 + `/api/health` | 로그인·프론트 변경 없음 |
| M2 | 로그인/세션/역할 — `/api/login`, `/api/logout`, 쿠키 서명 검증 | |
| M3 | `GET /api/state`(통짜 읽기) + `POST /api/migrate` + **레코드 단위** 쓰기 엔드포인트 전부 | 이 시점부터 서버가 진실의 원천(source of truth) |
| M4 | 프론트의 `save()` 호출 43곳을 레코드별 API 호출로 전환 | 가장 손이 많이 가는 단계 |
| M5 | 권한 반영 — 정산/비용/계약관리 API 403 처리 + 메뉴·대시보드 카드 숨김 + **aisim 금액 카드/컬럼/차트 필드 단위 숨김**(1.2, 가장 손이 감) | |
| M6 | 동시편집 충돌 UX(409 처리) + 30초 폴링 새로고침 | |
| M7 | 실제 배포 — `wrangler login`, D1 생성, secret 등록, 배포, 2개 브라우저로 교차 테스트 | 사용자와 같이 진행 |

---

## 11. 미결 질문 (착수 전 확인 필요)

권한 관련 4개 항목(aisim 공개 범위·대시보드 카드·계약관리·알림함)은 2026-10-24에 모두 확정됨(1장 참고). 남은 건:

1. **세션 만료 기간**(기본 30일 제안) 조정 필요 여부.
2. 팀 공용 비밀번호는 **얼마나 자주 바꿀 계획**인지(관리자가 바꾸면 전원 재로그인 필요).

---

## 12. 리스크

- **M4(프론트 전환)가 제일 큰 리스크** — 6천 줄 단일 파일에서 43개 호출 지점을 하나씩 바꾸는 과정이라 실수로 빠뜨리는 지점이 생길 수 있음. 전환 후 전체 기능 회귀 테스트가 필요.
- **D1 무료 티어 한계** — 소규모 사용엔 충분하지만, 추후 사용량이 늘면 비용 검토 필요(지금은 걱정할 단계 아님).
- **팀 공용 비밀번호 유출 시** — 전원 영향. 민감도가 높아지면(예: 외부 공개 계약서 수준) 1인 1계정으로 업그레이드하는 걸 고려할 것(이번 범위에서는 과함).
