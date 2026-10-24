# schedule-manager — 진행 상황 · 계획 · 작업 지침서

최종 갱신: 2026-10-24
연관 문서: [VERSIONS.md](VERSIONS.md)(과거 수동 버전 이력 — 이 문서 이후로는 git이 대신함)

---

## 1. 현재 진행 상황

### 완료

| 일자 | 커밋 | 내용 |
|---|---|---|
| 2026-10-23 | `891398a` | `_src/schedule-manager/`(원본), `schedule-manager/`(배포 산출물), `build.mjs`·`deploy.mjs`·`deploy-cf.bat`·`wrangler.jsonc`·`.assetsignore`(배포 도구)를 **처음으로 git에 커밋**. 그 전까지는 전부 untracked였고, 유일한 버전 이력은 `index-YYMMDD-AN.html` 파일명 복사뿐이었음 |
| 2026-10-23 | `602b57d` | 백업/복원 안전성 점검 결과 발견한 3개 결함을 수정 — 아래 "2) 백업/복원 보강" 참고 |
| 2026-10-23 | `4969df2` | 이 문서(`DEV_PLAN.md`) 작성 + `VERSIONS.md`의 stale 문구 수정 |
| 2026-10-24 | `d8fff41` | A1~A4 스냅샷 `_src/` 원본 정리 — 아래 "3) 스냅샷 정리" 참고 |

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

**3) 스냅샷 정리 — `_src/` 원본만, 배포 산출물은 그대로**
- `index-260915-A1.html`, `index-260917-A1~A3.html`, `index.260903-J5.min.html`을 `_src/schedule-manager/` → `_src/schedule-manager/_archive/`로 이동 (`git mv`, 100% rename — 내용 변경 없음).
- **의도적으로 범위를 좁힘**: 이 파일들은 로컬 원본일 뿐 아니라 라이브 사이트에도 각자 독립 주소로 배포돼 있고(`VERSIONS.md` 참고 — 같은 브라우저에서 두 버전을 열어 비교하는 용도), 사용자가 그 라이브 비교 URL을 유지하길 원함. 그래서 **배포 산출물(`schedule-manager/*.html`)과 `deploy.mjs`의 TARGETS 목록은 손대지 않음**.
- 부작용: 이제 `node deploy.mjs build`를 돌리면 이 4개 TARGETS 항목은 `_src` 경로가 없어 `건너뜀` 경고만 찍고 스킵됨(에러 아님) — 이미 배포된 산출물은 그대로 유지되므로 라이브 URL은 안 깨짐. 의도된 동작(더 이상 리빌드 안 할 냉동 스냅샷이므로).
- 검증: 이동 직후 `node deploy.mjs build` 실행 → `schedule-manager/index.html`·`index0.html`은 바이트 단위로 무변화(diff 없음) 확인. 단, 이 명령은 **schedule-manager 외 사이트 전체**(루트 `index.html`, `case-lms.html`, `LMS-SaaS-admin.html`, `OPS/Ops Console.dc.html`)도 같이 재빌드하므로, scope 밖 파일까지 손대지 않도록 다음엔 `node build.mjs <원본> <출력> ...`로 schedule-manager 대상만 직접 빌드할 것(3.1 참고).

### 미완료 / 보류

| 항목 | 상태 |
|---|---|
| git push | **안 함** — 로컬 커밋 5개(`891398a`~`d8fff41`) 쌓인 상태 |
| 메인 데이터(`si-workforce-v1`) 자체를 IndexedDB로 이전 | 안 함 — 이번엔 "별도 백업"만 IndexedDB에 추가, 주 저장소는 여전히 localStorage |
| 기기 간 동기화(Workers + D1/KV) | 미착수 |
| 에이전트 실연동(실제 LLM 호출) | 보류 — "에이전트가 실제로 무엇을 하는가"가 아직 미정 |

---

## 2. 앞으로의 계획

지난 논의에서 "개인/소규모 실사용", "단일 파일 유지" 기준으로 합의한 단계:

| 단계 | 내용 | 상태 |
|---|---|---|
| Phase 0 | git 버전관리 전환, 수동 스냅샷 정리 | **완료** — git 전환 + `_src` 스냅샷 정리 끝 (배포 산출물의 라이브 비교 URL은 의도적으로 보존) |
| Phase 1 | 데이터 안전 (손상 감지·백업·가져오기 검증) | **핵심 완료** — 남은 건 용량 한계 대응(메인 저장소 IndexedDB 이전) 정도 |
| Phase 2 | 기기 간 동기화 (선택) | 미착수 — 필요성 재확인 후 착수 |
| Phase 3 | 에이전트 실연동 (옵션) | 보류 — 에이전트 성격 결정 필요 |
| Phase 4 | 운영 완성도 (에러 처리·반응형·문서화) | 미착수 |

**다음으로 추천하는 순서:**
1. ~~A1~A4 스냅샷 파일 정리~~ — 완료 (`d8fff41`)
2. 지금까지 쌓인 커밋 5개 push 여부 결정
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
- `node deploy.mjs` / `node deploy.mjs build`는 **schedule-manager만이 아니라 사이트 전체**(루트 `index.html`, `case-lms.html`, `LMS-SaaS-admin.html`, `OPS/Ops Console.dc.html`)를 다시 빌드함. schedule-manager만 건드릴 땐 위의 `node build.mjs ...` 한 줄을 직접 쓸 것 — 그래야 scope 밖 파일에 손대지 않음.

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
