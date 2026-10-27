# schedule-manager — Phase 2 설계: 로그인 · 권한 · 다중 사용자 동기화

최종 갱신: 2026-10-24
상태: **설계 완료 — 구현 착수 가능** (모든 미결 질문 해소, 세션 만료 기간만 추후 재검토 예정 · 이는 구현에 지장 없음)
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

### 1.1 확정 — 메뉴 단위 (2026-10-24 최종 확정, 필드/카드 단위 분리안은 폐기)

처음엔 대시보드·AI 인력산정을 카드/컬럼 단위로 쪼개 일부만 공개하는 안을 검토했지만, **관리가 단순한 메뉴 단위 전부/전무 방식**으로 최종 확정했다. 상단 내비게이션의 10개 메뉴 기준:

| 메뉴 | 관리자 | 팀원 |
|---|---|---|
| 일정(gantt) | ✅ | ✅ |
| 업무보드(kanban) | ✅ | ✅ |
| 달력(calendar) | ✅ | ✅ |
| 에이전트 과업(agentops) | ✅ | ✅ |
| 대시보드(dashboard) | ✅ | ❌ |
| 인력관리(people) | ✅ | ❌ |
| 계약관리(contract) | ✅ | ❌ |
| 정산관리(settlement) | ✅ | ❌ |
| 비용관리(cost) | ✅ | ❌ |
| AI 인력산정(aisim) | ✅ | ❌ |
| **알림함(notices)** — 메뉴 아님, 별도 아이콘 | ✅ | ✅ — 팀원 공통 권한, 전역 공유 구조 그대로 |
| 로그인 | 이름 선택 + 팀 공용 비밀번호 (동일) | |

**관리자는 모든 메뉴 접근 가능.** 팀원은 위 4개 메뉴(일정·업무보드·달력·에이전트 과업) + 알림함만 접근하고, 나머지 6개 메뉴는 전부 막는다.

### 1.2 팀원 기본 시작 화면
`state.view`의 기본값이 `"dashboard"`인데 팀원은 대시보드에 못 들어가므로, **로그인 시 role이 member면 기본 view를 `"gantt"`(일정)로 지정**한다. 다른 화면을 기본으로 원하면 조정 가능.

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

### 3.3 세션 만료 · 비밀번호 교체
- 세션 만료: **우선 기본 30일로 구현**(소규모 신뢰 팀 도구 기준) — 최종 기간은 **추후 재검토**(미확정, 바꾸기 쉬운 설정값으로 둠).
- 팀 공용 비밀번호 교체 주기: **6개월**. 관리자가 교체하면 전원 재로그인이 필요하므로, 교체 시점을 팀에 미리 공지하는 걸 권장(기능상 강제는 아님 — 운영 규칙).

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
  - `role=member`면 관리자 전용 메뉴(대시보드·인력관리·계약관리·정산관리·비용관리·AI 인력산정)에서만 쓰는 데이터는 응답에서 제외: `expenses`, `contracts`, `rates`, `aiRates`, `aiStage`, `aiReinvest`, `aiCost`, `aiInvoices`, `aiScope`(서버에서 필터링 — 프론트가 메뉴를 숨기는 것만으론 부족, 네트워크 응답 자체에서 차단).
  - `members`는 팀원도 봐야 함(업무보드·일정의 담당자 이름 표시) — 단, 각 레코드에서 `rate`(개인 단가)는 `role=member`면 제외(이름·직무·등급만 전달).
  - `notices`는 역할 구분 없이 그대로 전부 반환(메뉴가 아니라 팀원 공통 권한, 1.1 참고).

### 5.3 쓰기 (레코드 단위 — 핵심 변경점)
엔티티별 CRUD, 예시(`tasks` 기준, 나머지도 동일 패턴):
- `POST /api/tasks` — 생성
- `PATCH /api/tasks/:id` `{..변경필드, ifUpdatedAt}` — 수정. **`ifUpdatedAt`이 서버의 현재 `updated_at`과 다르면 409 Conflict** 반환(다른 사람이 먼저 고침)
- `DELETE /api/tasks/:id`

`expenses`, `contracts`, `members`(생성/수정/삭제), `settings`(비용/정산/AI 관련 키)의 쓰기 엔드포인트는 `role=admin`만 허용(403). `notices`는 모든 role이 쓰기 가능(기존 동작 그대로).

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
- **권한에 따른 UI 숨김**: 로그인 응답의 `role`을 전역에 저장해 두고, `role==='member'`일 때 — 대시보드·인력관리·계약관리·정산관리·비용관리·AI 인력산정 **6개 메뉴 버튼 자체를 숨김**(`#nav button` 렌더링에서 제외) + 그 URL로 직접 진입해도 막음(`load()`에서 `view` 값 검증). 메뉴 단위라 카드·컬럼 단위로 쪼갤 필요 없음(1.1 참고). 알림함은 그대로 전체 공개.
- **팀원 기본 화면**: 로그인 직후 `state.view` 기본값을 `"gantt"`로 지정(1.2 참고, 대시보드가 기본값이던 걸 변경).
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
| M1 | D1 스키마 생성 + Worker 라우팅 뼈대 + `/api/health` | **완료** — 로컬 검증 + **실제 클라우드 D1까지 생성·스키마 적용 끝**. 로그인·프론트 변경 없음, 아래 "M1 완료 메모" 참고 |
| M2 | 로그인/세션/역할 — `/api/login`, `/api/logout`, 쿠키 서명 검증 | **완료** — 아래 "M2 완료 메모" 참고 |
| M3 | `GET /api/state`(통짜 읽기) + `POST /api/migrate` + **레코드 단위** 쓰기 엔드포인트 전부 | **완료** — D1이 진실의 원천이 됨(단, 프론트는 아직 연결 안 함). 아래 "M3 완료 메모" 참고 |
| M4 | 프론트의 `save()` 호출 43곳을 레코드별 API 호출로 전환 | **완료** — 단, 설계를 바꿔서 43곳은 안 건드림(아래 "M4 완료 메모" 참고) |
| M5 | 권한 반영 — 관리자 전용 6개 메뉴의 API 403 처리 + 프론트 메뉴 버튼 숨김(메뉴 단위라 비교적 단순) + 팀원 기본 화면을 "일정"으로 | **완료** — 아래 "M5 완료 메모" 참고 |
| M6 | 동시편집 충돌 UX(409 처리) + 30초 폴링 새로고침 | **완료** — 테스트 중 중대한 기존 버그도 발견·수정(아래 "M6 완료 메모") |
| M7 | 실제 배포 — `wrangler login`, D1 생성, secret 등록, 배포, 2개 브라우저로 교차 테스트 | 사용자와 같이 진행 |

---

### M5 완료 메모 (2026-10-25)

API 쪽 403은 이미 M3에서 끝나 있어서, M5는 **프론트에서 못 보이게 가리는** 부분만 남아 있었다. `ADMIN_ONLY_VIEWS = [dashboard, people, contract, settlement, cost, aisim]` 기준으로 3중 방어:

1. `load()` — 팀원인데 `state.view`가 이 목록에 있으면(예: `?view=cost` URL 파라미터로 들어온 경우 — 이전엔 아무 제약 없이 그대로 받아들였음) `"gantt"`로 되돌림. M4에서 대시보드 하나만 처리하던 걸 6개 전부로 일반화.
2. `render()` — 매 렌더링마다 같은 조건을 한 번 더 확인. 콘솔 조작 등 `load()`를 거치지 않고 `state.view`가 바뀌는 경로까지 방어.
3. nav 버튼 — 관리자 전용 6개는 `display:none`(관리자는 10개 전부 그대로). 클릭 핸들러 자체도 역할을 먼저 확인해서, 숨긴 버튼에 강제로 `.onclick()`을 호출해도 토스트만 뜨고 막힘.

**검증** (`wrangler dev`, 기존 테스트 계정 그대로 사용)
| 시나리오 | 결과 |
|---|---|
| 팀원 로그인 | nav 버튼 10개 중 6개가 `display:none`, 4개(일정·업무보드·에이전트과업·달력)만 노출 |
| 숨긴 "비용관리" 버튼에 강제로 `.onclick()` 호출 | `state.view` 안 바뀜(gantt 유지) |
| 콘솔에서 `state.view='settlement'` 직접 대입 + `render()` | 렌더링 전에 다시 `gantt`로 되돌아감 |
| `?view=cost`로 직접 URL 진입(팀원) | `gantt`로 리다이렉트 |
| 관리자 재로그인 | 숨긴 버튼 0개, `?view=cost`도 정상 진입 — 회귀 없음 |
| 사이트 정적 서빙 | 그대로 200 |

### M6 완료 메모 (2026-10-27)

**테스트 중 발견한 중대한 기존 버그 — 낙관적 동시성 체크가 사실상 작동 안 하고 있었음**

M6을 테스트하다가, 일부러 충돌을 만들었는데도 서버가 그냥 덮어써버리는 걸 발견했다. 원인 추적 결과: `worker/index.js`의 모든 엔티티 `fromRow()`가 **`updatedAt`을 응답에서 빠뜨리고 있었다.** `GET /api/state`로 불러온 레코드는 전부 `updatedAt: undefined` 상태였고, 그 상태로 수정해서 저장하면 `ifUpdatedAt: undefined`가 서버로 가는데 — 서버 쪽 체크(`if (body.ifUpdatedAt && ...)`)가 **값이 없으면 조건 자체를 건너뛰어** 충돌 검사가 그냥 생략됐다. 이 세션에서 직접 만들거나 수정해서 응답으로 `updatedAt`을 받은 레코드만 우연히 보호되고 있었던 것 — M3/M4 테스트 때는 항상 "방금 만든 레코드를 바로 수정"하는 패턴이라 이 버그가 안 드러났다.

**수정**: 9개 엔티티의 `fromRow()` 전부에 `updatedAt: r.updated_at` 추가(`reviews`/`notices`는 `data_json`을 통째로 복원하는 구조라 별도로 병합). 이건 M3/M4 시점부터 있던 결함을 지금 고친 것이다.

**M6 본래 범위**
- `pollServerState()` — 30초마다 `GET /api/state`를 불러와 다른 사람의 변경을 반영. 새 `mergeEntityFromServer()`가 레코드별로 "로컬이 스냅샷과 같으면(= 손 안 댄 상태)" 서버 값을 받아들이고, "스냅샷과 다르면(= 아직 저장 안 한 로컬 변경 있음)" 그대로 둔다 — 폴링이 한창 수정 중인 내용을 덮어쓰지 않게.
- `handleSyncError`가 409를 받으면 토스트만 띄우는 대신 `pendingConflicts`에 쌓아두고, `queueServerSync()`의 `.finally()`에서(= `lastSyncedSnapshot`이 막 확정된 직후) `resolveConflicts()`를 돌려 **그 레코드만** 서버 최신값으로 강제 덮어씀. "서버가 이긴다, 진 쪽에게 알린다"는 단순한 방식 — 설계서 6장이 이미 "실시간 동기화·병합 UI는 이 정도 빈도엔 과하다"고 판단한 선을 그대로 따름.

**검증** (`wrangler dev` + 로컬 D1, 브라우저 1개 + 별도 쿠키의 curl = 사실상 "두 사람")
| 시나리오 | 결과 |
|---|---|
| A. curl이 레코드 수정 → 브라우저는 그 레코드를 안 건드린 상태에서 `pollServerState()` | 서버 값으로 정확히 갱신 |
| B. 브라우저가 로컬에서만 수정(저장 안 함) → curl이 동시에 같은 레코드 수정 → `pollServerState()` | 로컬의 저장 전 값 그대로 유지(안 덮어씀) |
| C. (updatedAt 버그 고친 뒤) 브라우저가 수정+저장, 서버엔 이미 curl이 바꿔둔 최신값 있음 | **409 정확히 발생** → 토스트 뜸 → 로컬·스냅샷 모두 서버 최신값으로 자동 교체(브라우저가 시도한 값은 버려짐) |
| 사이트 정적 서빙 | 그대로 200 |

**테스트 중 추가로 확인한 로컬 전용 함정**: `wrangler dev`는 프로젝트 루트(assets.directory=".") 아래 **아무 파일 변화에나** 반응한다 — 테스트용으로 만들었다 지운 JSON 파일 하나에도 `ENOENT`로 죽었다. 이전에 봤던 `SQLITE_BUSY` 크래시들도 같은 원인(로컬 D1 파일 변경 감지)이었을 가능성이 높다. 이후로는 테스트용 임시 파일을 전부 스크래치패드(감시 대상 밖)에 둬서 재발 안 함.

---

### M5 사후 추가 1 — 관리자/팀원 권한 설정 UI (2026-10-25)

`authRole`이 M3부터 DB·API엔 있었지만 프론트 어디에도 안 보여서, 실제 관리자가 팀원 권한을 바꿀 방법이 **UI에 없었음**(제가 SQL로 직접 넣은 게 유일한 방법). 인력관리(이미 M5로 admin 전용) 멤버 편집 모달에 "로그인 권한" 선택란 추가 — `PATCH /api/members/:id`는 이미 있던 걸 그대로 씀.

**자기 강등 방지**: 수정 대상이 로그인한 본인이면 select를 `disabled`로 막고, `saveMember()`도 제출값을 무시하고 기존 값으로 고정 — 관리자가 실수로 자기 권한을 낮춰서 정산/비용 메뉴에서 스스로 튕겨나가는 걸 막음.

**PM/PMO 기본값**(사용자 요청: "관리자는 PM,PMO만 우선 설정해줘"): `seed()`의 멤버 생성 함수가 직무가 "PM"/"PMO"면 `authRole:"admin"`, 나머진 `"member"`를 자동으로 넣음 — 시드/데모 로스터에만 적용, 실제 팀원은 이 UI로 개별 조정.

검증: `seed()` 호출 → 정하늘(PM)·김도현(PMO)만 admin, 나머지 10명 member 정확히 확인. 박선우를 member→admin으로 바꿔 저장 → 독립적으로 `GET /api/state` 조회해도 서버에 정확히 반영됨.

### M5 사후 추가 2 — `resetDemoData()` 공유 데이터 삭제 위험 발견·수정 (2026-10-25)

위 테스트 중 콘솔에서 `seed()`를 직접 호출했더니, **로컬 D1의 기존 테스트 계정이 실제로 삭제되는** 뜻밖의 결과가 나왔다. 원인: `seed()`가 `state.members`(및 다른 배열들)를 통째로 새 배열로 교체 → 뒤따르는 `save()`가 M4의 diffing 동기화를 타면서, 사라진 기존 레코드를 "삭제됨"으로 판단해 서버에 DELETE를 보냄.

**왜 문제인가**: `resetDemoData()`("시연 데이터 초기화" 버튼)도 내부적으로 `seed()+save()`를 호출한다. M4 전에는 "이 브라우저의 localStorage만" 초기화하는 기능이었는데, 지금은 **서버(D1)와 동기화되는 상태라 이 버튼 하나로 팀 전체가 보는 공유 데이터가 통째로 날아갈 수 있다** — 그런데 확인창 문구는 여전히 "현재 브라우저에 저장된 데이터"라고만 돼 있어 이 위험을 안 알려주고 있었다. M4 작업 때 놓친 부분.

**수정**:
- `resetDemoData()` — `role=member`면 confirm조차 안 띄우고 토스트로 바로 거부. 관리자에게는 확인창 문구에 "서버(D1)와 동기화되는 상태라 팀 전체 공유 데이터까지 지워진다"는 경고를 명시적으로 추가.
- 사이드바 "기준정보"(표준단가·AI계수·위임규칙 설정 + 초기화 버튼) 전체를 M5와 같은 기준으로 팀원에게 숨김(`#baseInfoGroup`) — 전부 admin 전용 설정이라 애초에 보일 이유가 없었음.
- `openRateModal()`/`openAiRateModal()`/`openRulesModal()`도 nav 버튼 클릭 핸들러와 같은 패턴으로 역할 확인 후 거부(방어 한 겹 더).

검증: 팀원 세션 — `resetDemoData()`와 모달 열기 함수 3개 전부 즉시 토스트로 거부(confirm 창 자체가 안 뜸), `#baseInfoGroup` computed display `"none"`. 관리자 세션 — `#baseInfoGroup` 정상 노출, confirm() 메시지를 가로채 확인해보니 새 경고 문구 정확히 포함(실제로는 취소 처리해 데이터는 안 건드림).

---

### M4 완료 메모 (2026-10-24) — 설계 변경: diffing 방식 채택

**왜 43곳을 그대로 뒀는가**: 설계서 자체가 M4를 "6천 줄 단일 파일에서 43개 호출 지점을 하나씩 바꾸다 실수로 빠뜨릴 위험"이 제일 큰 단계로 꼽았다. 그래서 7장에 대안으로 적어뒀던 **"diffing 방식"**을 실제로 채택 — `save()` 내부만 바꿔서, 호출될 때마다 직전에 서버와 맞춘 사본(`lastSyncedSnapshot`)과 지금 `state`를 엔티티별로 비교해 **새로 생긴 레코드는 POST, 바뀐 레코드는 PATCH(`ifUpdatedAt`으로 낙관적 동시성), 없어진 레코드는 DELETE**로 백그라운드로 보낸다. 43곳은 지금도 `state`를 고치고 `save()`만 부른다 — 한 글자도 안 바뀜. "레코드 단위로 쓴다"는 설계 목표(통째 덮어쓰기 방지)는 그대로 달성됨.

**로그인 화면**: 설계서는 "이름 선택(드롭다운)"이라 적었지만, 로그인 전엔 세션이 없어 멤버 목록을 받아올 API가 없다(만들려면 인증 없이 이름을 노출하는 새 엔드포인트가 필요). 그래서 **자유 텍스트 입력**으로 바꿈 — 추가 엔드포인트 없이 더 단순하고, 로그인 전 멤버 명단 노출도 없음.

**바뀐 부트스트랩 흐름**: `load()`가 비동기가 됨 — `GET /api/whoami`로 세션 확인 → 없으면 로그인 화면만 띄우고 멈춤 → 있으면 `GET /api/state`로 `state`를 채움. **`seed()`는 이 경로에서 더 이상 안 부름** — 빈 D1에 아무나 로그인할 때마다 데모 데이터가 자동으로 채워져 공유 DB를 오염시키는 걸 막기 위함(`seed()` 함수 자체와 `resetDemoData()`는 그대로 남겨둠, 관리자가 수동으로 쓸 수 있게). 팀원 로그인 시 기본 화면은 "일정"(1.2 참고).

**save()는 그대로 동기**: 로컬 저장(localStorage + Phase 1 IndexedDB 자동백업)은 지금처럼 즉시 끝나고, 서버 동기화만 백그라운드로 흘려보낸다(호출자를 안 기다리게 함 — 클릭했는데 느려지는 일 없음).

**실패 처리**: 403(권한 없음)·409(충돌)·네트워크 오류가 나면 그 레코드는 스냅샷을 갱신하지 않아 **다음 save() 때 자동으로 다시 시도**된다. 토스트로 알리기만 하고 앱이 죽지 않음. 제대로 된 충돌 해결 UX는 M6 몫.

**검증** (`wrangler dev` + 로컬 D1에 실제 비슷한 시드 데이터 — 프로젝트·과업·멤버·마일스톤 — 넣고 **진짜 브라우저**로 전부 확인, 원격 DB는 무관)
| 시나리오 | 결과 |
|---|---|
| 이전 M2 테스트의 세션 쿠키가 남아 새로고침해도 유지됨 | 자동으로 whoami 성공 → 대시보드에 실제 D1 데이터 렌더링(의도치 않은 추가 확인) |
| 로그아웃 → 로그인 화면 | 정상 표시 |
| 폼에 직접 입력해 팀원 계정 로그인 | 기본 화면이 "일정"(대시보드 아님), 시드 데이터가 D1→API→렌더링까지 정확히 표시 |
| 콘솔에서 `state.tasks[0]` 직접 수정 + `save()` | 잠시 뒤 `GET /api/state`로 독립 조회해도 서버에 동일하게 반영됨(PATCH 경로 확인) |
| 새 과업을 `state.tasks.push()` + `save()` | 서버에 생성됨(POST 경로 확인) |
| 팀원이 `state.expenses.push()`(admin 전용) + `save()` | **서버에 전혀 안 올라감**(403으로 차단, member의 `GET /api/state`엔 `expenses` 키 자체가 없음), 앱도 안 죽음 |
| 관리자 재로그인 | 정상, 테스트 레코드 전부 삭제로 정리 |
| 사이트 정적 서빙(`/`, `/case-lms`) | 그대로 200 |

가설 추정치 상수(`DEFAULT_RATES`/`DEFAULT_AI_RATES`/`AI_STAGE` 등)는 이번에도 손대지 않음.

---

### M3 완료 메모 (2026-10-24)

**빠져 있던 테이블 발견·보완**: `state.noticeActions`(통보 확인/승인 기록 — 자체 id 없는 추가 전용 로그)가 0001 스키마에 없었음. `migrations/0002_notice_actions.sql`로 추가(로컬·원격 D1 둘 다 적용). `reviewRollups`는 코드에 선언·초기화만 있고 실제로 채워지는 곳이 하나도 없어(2026-10-24 기준 항상 빈 배열), 별도 테이블 없이 `settings`에 같이 둠.

**권한 플래그 근거**: `readAdmin`/`writeAdmin`을 추측 아니라 `renderGantt`/`renderKanban`/`renderCalendar`/`renderAgentOps`(팀원 접근 가능 메뉴) 코드를 직접 확인해서 정함 — 넷 다 `state.assignments`/`expenses`/`contracts`/`rates`를 전혀 참조하지 않음 → 이 네 엔티티는 읽기·쓰기 전부 admin 전용. `members`는 업무보드·일정의 담당자 이름 표시에 필요해 전원 읽을 수 있게 하되, 레코드별 `rate`(개인 단가)만 `role=member`면 응답에서 뺌.

**만든 엔드포인트**
- `GET /api/state` — 모든 동기화 엔티티 + `noticeActions` + `settings`를 모아 기존 `state`와 같은 모양으로 반환, 위 권한에 따라 서버에서 필터링(프론트가 숨기는 것과 별개로 네트워크 응답 자체에서 차단)
- `POST /api/<entity>`, `PATCH /api/<entity>/:id`, `DELETE /api/<entity>/:id` — projects·categories·milestones·tasks·assignments·members·expenses·contracts·reviews·notices. PATCH는 전체 레코드를 받고(앱이 원래 메모리에서 객체 전체를 고친 뒤 저장하는 방식과 동일), `ifUpdatedAt`을 보내면 낙관적 동시성 체크(불일치 시 409 + 현재값)
- `POST /api/noticeActions` — 추가만 가능(앱 자체 설계와 동일), 역할 무관하게 로그인만 하면 가능
- `PATCH /api/settings/:key` — `rates`/`aiRates` 등 전역 설정값, 전부 admin 전용(운영 규칙값인 `reviewSlaDays`도 포함)
- `POST /api/migrate` — 기존 `exportData()` JSON을 그대로 받아 D1에 일괄 적재(admin만, 하나의 batch로 전부 성공하거나 전부 롤백)

**검증** (`wrangler dev` + 로컬 D1, **원격 DB 데이터는 안 건드림** — 스키마만 두 마이그레이션으로 적용)
| 시나리오 | 결과 |
|---|---|
| `GET /api/state` — admin | `assignments·contracts·expenses` 포함 |
| `GET /api/state` — member | 위 셋 제외, `members`는 있지만 각 행의 `rate` 없음 |
| `PATCH /api/settings/rates` — member | 403, admin | 200 → admin의 `state.rates`엔 보이고 member껀 안 보임 |
| project 생성(member, 공통 메뉴 데이터) → 수정 → 잘못된 `ifUpdatedAt`으로 재수정 → 삭제 | 201 → 200 → **409(currentUpdatedAt 포함)** → 200 |
| expense 생성 — member | 403, admin | 201 |
| `POST /api/migrate` — member | 403, admin | 200 — `projects:1, tasks:1, expenses:1, noticeActions:1, settings:2` 정확히 집계, 한글·배열·불리언 전부 왕복 확인 |
| 사이트 정적 서빙 + `/worker/`·`/migrations/` 비공개 | 그대로 유지 |

**로컬 전용 함정 재발**: `wrangler dev` 구동 중 `SQLITE_BUSY`로 두 번 더 죽음 — 이번엔 동시에 다른 `d1 execute` 명령을 돌리지 않았는데도 발생해, dev 서버 자체의 파일 감시가 로컬 D1 파일 변경을 "소스 변경"으로 오인해 재시작을 거는 것으로 보임. 재시작하면 바로 정상화됨. 두 번 다 **크래시 직전까지의 모든 요청은 전부 정답**이었음(코드 문제 아님). 운영 D1(클라우드)은 로컬 파일이 아니라 이 문제와 무관.

---

### M2 완료 메모 (2026-10-24)

**만든 것** — `worker/index.js`에 추가(프론트 변경 없음, 로그인 화면은 M3/M4 때 붙임)
- `POST /api/login` `{name, password}` — D1 `members`에서 이름 조회 + `TEAM_PASSWORD` Secret과 SHA-256 다이제스트 상수시간 비교. 성공 시 서명된 세션 쿠키 발급(httpOnly·Secure·SameSite=Lax·30일). 비밀번호 틀림과 이름 없음을 같은 `invalid_credentials`로 응답(계정 존재 여부 노출 방지)
- `POST /api/logout` — 쿠키 제거
- `GET /api/whoami` — 세션 없으면 401, 있으면 memberId/name/role
- `GET /api/health`에 현재 세션 정보도 같이 표시(점검용)
- 세션은 `base64url(JSON payload).base64url(HMAC-SHA256 서명)` 형태의 무상태 토큰 — `crypto.subtle.verify`로 검증, 세션 테이블 없음(3.1~3.2 근거 그대로)

**로컬 비밀값**: `.dev.vars`(TEAM_PASSWORD·SESSION_SECRET 테스트용 값) 추가 + 이 저장소에 없었던 `.gitignore` 신설(`.dev.vars`, `.wrangler/`, `node_modules/` 제외) + `.assetsignore`에도 `.dev.vars` 추가(배포 시 공개 서빙 방지, 이중 안전장치)

**검증** (`wrangler dev`, 로컬 D1에 테스트 멤버 2명 — `test-admin-1`/admin, `test-member-1`/member — 수동 삽입, **원격 DB는 건드리지 않음**)
| 시나리오 | 결과 |
|---|---|
| 세션 없이 `/api/whoami` | 401 |
| 잘못된 비밀번호 | 401 |
| 관리자 로그인 | 200 + 쿠키, 응답에 `role:"admin"` |
| 쿠키로 `/api/whoami` | 200, 올바른 역할 |
| `/api/health` | 세션 정보 같이 표시 |
| 로그아웃 → `/api/whoami` | 401로 복귀 |
| 팀원 로그인 | 200, `role:"member"` |
| 사이트 전체 정적 페이지 | 그대로 200(영향 없음) |
| `/.dev.vars` | 404(비공개 확인) |

**발견한 로컬 전용 함정**: `wrangler dev` 구동 중에 같은 로컬 D1 파일에 `wrangler d1 execute --local`을 동시에 실행하면 `SQLITE_BUSY`로 dev 서버가 죽음. DB 작업은 `wrangler dev` 띄우기 **전에** 끝낼 것(운영 D1은 로컬 파일이 아니라 클라우드라 이 문제와 무관).

**사용자가 나중에 직접 해야 하는 것(실제 배포 시, M7)**: `wrangler secret put TEAM_PASSWORD`(팀이 쓸 실제 비밀번호, 본인이 정함), `wrangler secret put SESSION_SECRET`(랜덤 서명 키 — 제가 생성해드릴 수 있음). 지금은 로컬 테스트값(`.dev.vars`)만 쓰고 있어 운영 비밀값은 아직 없음.

---

### M1 완료 메모 (2026-10-24, 로컬)

**만든 것**
- `migrations/0001_initial.sql` — 4장 스키마 그대로 SQL화(인덱스 포함, 20개 명령)
- `worker/index.js` — `/api/*`만 처리하고 나머지는 그대로 정적 서빙에 맡기는 라우터. `/api/health`가 D1 연결까지 확인
- `wrangler.jsonc`에 `main`(Worker 코드), `assets.binding`, `d1_databases` 바인딩 추가 — 기존 `assets.directory` 설정은 그대로 둠
- `.assetsignore`에 `worker/`·`migrations/` 추가(공개 서빙 방지), 기존에 빠져 있던 `deploy.mjs`도 같이 추가

**로컬 검증 결과** (`wrangler dev`)
| 확인 항목 | 결과 |
|---|---|
| `GET /api/health` | `{"ok":true,"db":"connected",...}` — D1 바인딩 정상 |
| `GET /api/존재안함` | JSON 404(API 전용 처리) |
| `GET /`, `/schedule-manager/`, `/case-lms` 등 기존 페이지 | **그대로 200 — 정적 서빙 영향 없음 확인** |
| 없는 정적 경로 | 기존 404 페이지로 정상 폴백 |
| `/worker/index.js`, `/migrations/*.sql` | 404 — `.assetsignore`로 비공개 유지 확인 |

로컬 D1(`.wrangler/state/`)에 마이그레이션 적용까지 끝남. **git에는 올리지 않음**(로컬 전용 캐시).

**실제 클라우드 D1 생성 — 완료 (2026-10-24)**
사용자가 `wrangler login` 완료 후 직접 진행:
```bash
npx wrangler d1 create schedule-manager-db
# → database_id: 632d64d4-f5ec-4aaa-9e78-9d510162559b (APAC 리전)
npx wrangler d1 migrations apply schedule-manager-db --remote
```
`wrangler.jsonc`의 자리표시자를 실제 `database_id`로 교체하고 커밋(`bed73f3`). 검증:
- `wrangler d1 migrations list --remote` → "No migrations to apply!"
- `SELECT name FROM sqlite_master WHERE type='table'` → 10개 테이블 전부 확인

참고 — `wrangler d1 migrations apply --remote` 실행 중 뜨는 확인 프롬프트(Y/n)는 Claude Code 터미널 패널에서 사용자 키 입력이 안정적으로 전달되지 않는 경우가 있었음. `$env:CI='true'` 로 비대화형 모드를 강제해 우회(프롬프트를 기본값 "yes"로 자동 처리). 다음에도 터미널 프롬프트가 막히면 이 방법을 먼저 시도할 것.

배포(`wrangler deploy`)는 아직 안 함 — D1 리소스 자체는 생성됐지만 Worker 코드는 아직 운영 사이트(`eulim.dataplaner.workers.dev`)에 올라가지 않음. M2(로그인)와 묶어서 배포 예정.

---

## 11. 미결 질문 — 전부 해소됨 (2026-10-24)

- 권한 모델(메뉴별 접근) — 1장 참고.
- 세션 만료 기간 — **우선 30일로 구현, 최종 기간은 추후 재검토**(3.3 참고). 구현을 막는 미결은 아님.
- 팀 공용 비밀번호 교체 주기 — **6개월**(3.3 참고).

→ 이 문서의 설계는 **구현 착수 가능** 상태. 다음 단계는 10장의 M1(D1 스키마 + Worker 라우팅 뼈대).

---

## 12. 리스크

- **M4(프론트 전환)가 제일 큰 리스크** — 6천 줄 단일 파일에서 43개 호출 지점을 하나씩 바꾸는 과정이라 실수로 빠뜨리는 지점이 생길 수 있음. 전환 후 전체 기능 회귀 테스트가 필요.
- **D1 무료 티어 한계** — 소규모 사용엔 충분하지만, 추후 사용량이 늘면 비용 검토 필요(지금은 걱정할 단계 아님).
- **팀 공용 비밀번호 유출 시** — 전원 영향. 민감도가 높아지면(예: 외부 공개 계약서 수준) 1인 1계정으로 업그레이드하는 걸 고려할 것(이번 범위에서는 과함).

**백업 체계 — 2026-10-27 결정**: 배포(M7) 전 운영 사이트에 실제 데이터가 없음을 확인(데모 데이터뿐). D1 자체 내장 "Time Travel"(최근 30일 내 임의 시점 복구, 추가 설정·비용 없음 — [공식 문서](https://developers.cloudflare.com/d1/reference/time-travel/))과 기존 "JSON 백업"(`exportData()`, 로그인 상태에선 D1 내용 그대로 내려받음) **두 겹으로 지금 수준에서 충분**하다고 판단, 별도 정기 자동 백업(Cron 등)은 만들지 않기로 함. 사용량·민감도가 커지면 재검토.
