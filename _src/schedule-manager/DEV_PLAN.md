# schedule-manager — 진행 상황 · 계획 · 작업 지침서

최종 갱신: 2026-10-23
연관 문서: [VERSIONS.md](VERSIONS.md)(과거 수동 버전 이력 — 이 문서 이후로는 git이 대신함)

---

## 1. 현재 진행 상황

### 완료

| 일자 | 커밋 | 내용 |
|---|---|---|
| 2026-10-23 | `891398a` | `_src/schedule-manager/`(원본), `schedule-manager/`(배포 산출물), `build.mjs`·`deploy.mjs`·`deploy-cf.bat`·`wrangler.jsonc`·`.assetsignore`(배포 도구)를 **처음으로 git에 커밋**. 그 전까지는 전부 untracked였고, 유일한 버전 이력은 `index-YYMMDD-AN.html` 파일명 복사뿐이었음 |
| 2026-10-23 | `602b57d` | 백업/복원 안전성 점검 결과 발견한 3개 결함을 수정 — 아래 "2) 백업/복원 보강" 참고 |

**1) git 전환**
- 실제 작업 원본이 `_src/schedule-manager/index-260917-A4.html`(현재 공개 버전의 소스)에 있고, 배포본 `schedule-manager/index.html`은 `build.mjs`가 만든 미니파이 산출물이라는 걸 확인.
- 이제 git이 버전 이력을 지므로, 이후로는 `index-YYMMDD-AN.html` 파일명 복사 방식 대신 **커밋**으로 버전을 남김 (상세 규칙은 3장).

**2) 백업/복원 보강** — [자세한 점검 결과는 이전 대화 참고]
기존 `exportData()`/`importData()`(수동 JSON 백업)는 있었지만, 아래 세 가지가 비어 있었음:
- `load()`가 저장 데이터 파싱 실패를 **조용히 무시** — 손상돼도 사용자가 모름
- **자동/주기적 백업이 전혀 없음** — 수동으로 안 누르면 백업 자체가 없음
- `importData()`에 **스키마 검증 없음** — 아무 JSON이나 구조만 맞으면 그대로 덮어씀

세 가지 모두 수정·검증·커밋 완료:
- `loadWasCorrupted` 플래그 + `warnIfCorrupted()` — 손상 감지 시 자동 백업 복원 제안, 없으면 명확히 경고
- `save()`가 10분 간격으로 IndexedDB(`si-workforce-backups`)에 롤링 백업(최근 10개, 자동 정리) 기록 + "자동백업" 버튼으로 수동 복원도 가능
- `validateImportShape()` — 가져오기 전 최소 구조 검증

로컬 HTTP 서버(`python -m http.server`)로 실제 브라우저에서 전 경로(손상 감지·자동백업 쌓임/정리·검증 거부/통과·정상 새로고침 회귀) 검증함. `file://`로 열면 `data:` URL 스냅샷이 되어 IndexedDB가 안 되므로 **반드시 로컬 서버로 테스트할 것** (3장 참고).

### 미완료 / 보류

| 항목 | 상태 |
|---|---|
| A1~A4 스냅샷 파일 정리 (`_src/`·`schedule-manager/` 양쪽) | 미착수 — 점검을 먼저 하기로 하고 보류됨 |
| git push | **안 함** — 로컬 커밋만 두 개 있는 상태 |
| 메인 데이터(`si-workforce-v1`) 자체를 IndexedDB로 이전 | 안 함 — 이번엔 "별도 백업"만 IndexedDB에 추가, 주 저장소는 여전히 localStorage |
| 기기 간 동기화(Workers + D1/KV) | 미착수 |
| 에이전트 실연동(실제 LLM 호출) | 보류 — "에이전트가 실제로 무엇을 하는가"가 아직 미정 |

---

## 2. 앞으로의 계획

지난 논의에서 "개인/소규모 실사용", "단일 파일 유지" 기준으로 합의한 단계:

| 단계 | 내용 | 상태 |
|---|---|---|
| Phase 0 | git 버전관리 전환, 수동 스냅샷 정리 | **절반 완료** — git 전환 끝, 스냅샷 정리 남음 |
| Phase 1 | 데이터 안전 (손상 감지·백업·가져오기 검증) | **핵심 완료** — 남은 건 용량 한계 대응(메인 저장소 IndexedDB 이전) 정도 |
| Phase 2 | 기기 간 동기화 (선택) | 미착수 — 필요성 재확인 후 착수 |
| Phase 3 | 에이전트 실연동 (옵션) | 보류 — 에이전트 성격 결정 필요 |
| Phase 4 | 운영 완성도 (에러 처리·반응형·문서화) | 미착수 |

**다음으로 추천하는 순서:**
1. A1~A4 스냅샷 파일 정리 (Phase 0 마무리) — git이 이력을 지니 파일명 복사본은 정리하거나 `_archive/`로 이동
2. 이번 커밋 2개 push 여부 결정
3. Phase 1 마무리 여부 판단 (지금 수준으로 충분한지, 메인 저장소까지 옮길지)
4. Phase 2(동기화) 필요한지 재확인 — 혼자 쓰면 불필요할 수 있음
5. Phase 3(에이전트) 방향 결정 시 재논의

---

## 3. 작업 지침서

### 3.1 소스 수정 위치 — 반드시 지킬 것
```
원본(수정 대상)   _src/schedule-manager/index-260917-A4.html   ← 여기만 고친다
                       │  node build.mjs <원본> <출력> "<제목>" <빌드ID>
                       ▼
배포 산출물(자동 생성)  schedule-manager/index.html              ← 직접 고치지 않는다, 빌드로만 갱신
```
- `schedule-manager/index.html`을 직접 편집하면 다음 빌드 때 덮어써짐. 항상 `_src/` 쪽을 고치고 빌드로 반영.
- 빌드 명령 (저장소 루트에서):
  ```bash
  node build.mjs "_src/schedule-manager/index-260917-A4.html" "schedule-manager/index.html" "Agent UX · 사람+에이전트 프로젝트 매니저" "EU-AUX-260917-A4"
  ```
- 전체 사이트 빌드+배포는 `node deploy.mjs` (빌드만: `node deploy.mjs build`).

### 3.2 버전관리 — git으로 전환됨
- **더 이상 `index-YYMMDD-AN.html` 파일명 복사로 버전을 만들지 않는다.** `_src/schedule-manager/index-260917-A4.html` 하나를 계속 고치고, 의미 있는 단위로 `git commit`.
- 과거 스냅샷(A1~A4, index0.html 등)은 git 히스토리(`891398a`)에 이미 남아 있으므로 삭제해도 이력이 사라지지 않음.
- 커밋 범위는 **schedule-manager 관련 파일로만 좁힐 것** — 저장소 루트에 무관한 변경이 대량으로 쌓여 있으므로, `git add` 시 경로를 명시적으로 지정 (`git status`로 먼저 확인).
- 커밋 메시지 끝에 `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` 포함 (세션 규칙).

### 3.3 테스트 방법 — file:// 로는 일부 기능이 검증되지 않음
- `file://`로 직접 열면 브라우저 미리보기가 `data:` URL 스냅샷으로 렌더링되어 **IndexedDB 등 일부 API가 실제와 다르게 동작**함.
- 자동 백업처럼 IndexedDB를 쓰는 기능을 테스트할 땐 로컬 서버를 띄울 것:
  ```bash
  cd schedule-manager && python -m http.server 8743 --bind 127.0.0.1
  ```
  그 후 `http://127.0.0.1:8743/index.html`로 접속.

### 3.4 데이터 키 레퍼런스
| 키 | 저장소 | 용도 |
|---|---|---|
| `si-workforce-v1` | `localStorage` | 메인 애플리케이션 상태 (단일 지점 — 용량 한계 3.5MB 근접 시 경고) |
| `si-workforce-backups` | `IndexedDB` | 자동 롤링 백업(최근 10개, 10분 간격) — 2026-10-23 추가 |

### 3.5 배포/공개 주의
- `.assetsignore`가 `_src/`, `*.md`, 빌드 도구 등을 배포 대상에서 제외함 — **새 파일·폴더를 추가할 때마다 `.assetsignore`에도 반영됐는지 확인**.
- `wrangler.jsonc`에 Cloudflare `account_id`가 평문으로 있음(비밀값은 아니지만) — API 토큰 등 실제 비밀값은 절대 이 저장소에 커밋하지 않음.

### 3.6 다음 세션에서 바로 참고할 것
- 이 문서(`DEV_PLAN.md`)와 `VERSIONS.md`를 먼저 읽고 시작.
- "1. 현재 진행 상황"의 미완료 항목부터 확인.
