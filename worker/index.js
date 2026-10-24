/*
 * eulim-site Worker — schedule-manager Phase 2
 *
 * 역할 분담:
 *   - /api/* 로 시작하는 요청만 이 스크립트가 처리한다.
 *   - 그 외 모든 요청(사이트 전체의 정적 파일)은 손대지 않는다 —
 *     Cloudflare가 assets 매니페스트와 먼저 매치를 시도하고(기본 동작,
 *     run_worker_first 를 켜지 않는 한), 매치되면 이 스크립트는
 *     아예 호출되지 않는다. 매치되지 않는 경우에만(= 실제로 없는 경로)
 *     이 스크립트가 호출되므로, 그런 경우엔 기존처럼 ASSETS 바인딩에
 *     그대로 넘겨 wrangler.jsonc의 not_found_handling(404 페이지)이
 *     적용되게 한다.
 *
 * M1: /api/health — D1 바인딩 확인용.
 * M2: /api/login, /api/logout, /api/whoami — 세션 쿠키 발급·검증.
 * M3(이 커밋): GET /api/state(권한별 필터링된 통짜 읽기), 엔티티별
 *   레코드 단위 CRUD(/api/<entity>[/:id]), POST /api/migrate(1회성
 *   가져오기), PATCH /api/settings/:key. 이 시점부터 D1이 진실의
 *   원천 — 다만 프론트(index-260917-A4.html)는 아직 이 API를 호출하지
 *   않는다(M4에서 save()/load()를 이 엔드포인트들로 전환).
 */

const SESSION_COOKIE = "sm_session";
// 30일 — PHASE2_DESIGN.md 3.3: 우선 이 값으로 구현, 최종 기간은 추후 재검토.
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

/* ── 엔티티 레지스트리 ──────────────────────────────────────────
   PHASE2_DESIGN.md 4장 스키마 ↔ 기존 state 필드 모양 매핑.
   readAdmin: GET /api/state에서 role=member면 통째로 제외.
   writeAdmin: 생성/수정/삭제가 role=admin만 허용(403).
   실제로 어느 메뉴가 어떤 데이터를 쓰는지 renderGantt/renderKanban/
   renderCalendar/renderAgentOps 코드를 직접 확인해 정함 — 공통 메뉴
   (일정·업무보드·달력·에이전트과업)는 assignments/expenses/contracts/
   rates를 전혀 참조하지 않는다. */
const ENTITIES = {
  projects: {
    table: "projects",
    writeAdmin: false,
    readAdmin: false,
    toRow(o) {
      return {
        id: o.id,
        name: o.name ?? null,
        client: o.client ?? null,
        color: o.color ?? null,
        start: o.start ?? null,
        end: o.end ?? null,
        status: o.status ?? null,
        kind: o.kind ?? null,
        desc: o.desc ?? null,
        pm_id: o.pmId ?? null,
      };
    },
    fromRow(r) {
      return {
        id: r.id, name: r.name, client: r.client, color: r.color, start: r.start, end: r.end,
        status: r.status, kind: r.kind, desc: r.desc, pmId: r.pm_id,
      };
    },
  },
  categories: {
    table: "categories",
    writeAdmin: false,
    readAdmin: false,
    toRow(o) {
      return { id: o.id, name: o.name ?? null, color: o.color ?? null };
    },
    fromRow(r) {
      return { id: r.id, name: r.name, color: r.color };
    },
  },
  milestones: {
    table: "milestones",
    writeAdmin: false,
    readAdmin: false,
    toRow(o) {
      return { id: o.id, project_id: o.projectId ?? null, name: o.name ?? null, start: o.start ?? null, end: o.end ?? null };
    },
    fromRow(r) {
      return { id: r.id, projectId: r.project_id, name: r.name, start: r.start, end: r.end };
    },
  },
  tasks: {
    table: "tasks",
    writeAdmin: false,
    readAdmin: false,
    toRow(o) {
      return {
        id: o.id,
        project_id: o.projectId ?? null,
        milestone_id: o.milestoneId ?? null,
        title: o.title ?? null,
        desc: o.desc ?? null,
        assignee_id: o.assigneeId ?? null,
        category_id: o.categoryId ?? null,
        start: o.start ?? null,
        due: o.due ?? null,
        status: o.status ?? null,
        priority: o.priority ?? null,
        md: o.md ?? null,
        tags_json: JSON.stringify(o.tags ?? []),
        recurrence: o.recurrence ?? null,
        completed_at: o.completedAt ?? null,
        spawned: o.spawned ? 1 : 0,
        executor: o.executor ?? null,
        agent_spec_json: o.agentSpec != null ? JSON.stringify(o.agentSpec) : null,
      };
    },
    fromRow(r) {
      return {
        id: r.id, projectId: r.project_id, milestoneId: r.milestone_id, title: r.title, desc: r.desc,
        assigneeId: r.assignee_id, categoryId: r.category_id, start: r.start, due: r.due, status: r.status,
        priority: r.priority, md: r.md, tags: r.tags_json ? JSON.parse(r.tags_json) : [],
        recurrence: r.recurrence, completedAt: r.completed_at, spawned: !!r.spawned,
        executor: r.executor, agentSpec: r.agent_spec_json ? JSON.parse(r.agent_spec_json) : null,
      };
    },
  },
  assignments: {
    // 인력관리·정산관리·대시보드·AI 인력산정(전부 admin 전용 메뉴) 소관.
    table: "assignments",
    writeAdmin: true,
    readAdmin: true,
    toRow(o) {
      return {
        id: o.id, member_id: o.memberId ?? null, project_id: o.projectId ?? null, role: o.role ?? null,
        from_ym: o.from ?? null, to_ym: o.to ?? null, alloc_json: JSON.stringify(o.alloc ?? {}),
      };
    },
    fromRow(r) {
      return {
        id: r.id, memberId: r.member_id, projectId: r.project_id, role: r.role,
        from: r.from_ym, to: r.to_ym, alloc: r.alloc_json ? JSON.parse(r.alloc_json) : {},
      };
    },
  },
  members: {
    // 쓰기는 admin 전용(인력관리 메뉴 소관)이지만, 읽기는 전원 필요
    // (업무보드·일정의 담당자 이름 표시) — rate(개인 단가)만 member 응답에서 뺀다.
    table: "members",
    writeAdmin: true,
    readAdmin: false,
    toRow(o) {
      return {
        id: o.id, name: o.name ?? null, role_title: o.role ?? null, grade: o.grade ?? null,
        emp: o.emp ?? null, org: o.org ?? null, rate: o.rate ?? null, skill: o.skill ?? null,
        auth_role: o.authRole || "member",
      };
    },
    fromRow(r, opts) {
      return {
        id: r.id, name: r.name, role: r.role_title, grade: r.grade, emp: r.emp, org: r.org,
        rate: opts && opts.stripRate ? undefined : r.rate, skill: r.skill, authRole: r.auth_role,
      };
    },
  },
  expenses: {
    table: "expenses",
    writeAdmin: true,
    readAdmin: true,
    toRow(o) {
      return {
        id: o.id, project_id: o.projectId ?? null, date: o.date ?? null, category: o.category ?? null,
        amount: o.amount ?? null, vendor: o.vendor ?? null, status: o.status ?? null,
        vat_flag: o.vatIncluded ? 1 : 0, memo: o.memo ?? null,
      };
    },
    fromRow(r) {
      return {
        id: r.id, projectId: r.project_id, date: r.date, category: r.category, amount: r.amount,
        vendor: r.vendor, status: r.status, vatIncluded: !!r.vat_flag, memo: r.memo,
      };
    },
  },
  contracts: {
    table: "contracts",
    writeAdmin: true,
    readAdmin: true,
    toRow(o) {
      return {
        id: o.id, project_id: o.projectId ?? null, no: o.no ?? null, type: o.type ?? null,
        amount: o.amount ?? null, vat_included: o.vatIncluded ? 1 : 0, mm: o.mm ?? null,
        signed: o.signed ?? null, start: o.start ?? null, end: o.end ?? null, owner: o.owner ?? null,
        warranty: o.warranty ?? null, note: o.note ?? null, phases_json: JSON.stringify(o.phases ?? []),
      };
    },
    fromRow(r) {
      return {
        id: r.id, projectId: r.project_id, no: r.no, type: r.type, amount: r.amount,
        vatIncluded: !!r.vat_included, mm: r.mm, signed: r.signed, start: r.start, end: r.end,
        owner: r.owner, warranty: r.warranty, note: r.note,
        phases: r.phases_json ? JSON.parse(r.phases_json) : [],
      };
    },
  },
  reviews: {
    // 구조가 복잡하고(findings[], escapes[] 등) 자주 안 바뀌어 통째로 JSON 보관.
    table: "reviews",
    writeAdmin: false,
    readAdmin: false,
    toRow(o) {
      return { id: o.id, task_id: o.taskId ?? null, data_json: JSON.stringify(o) };
    },
    fromRow(r) {
      try {
        return JSON.parse(r.data_json);
      } catch (err) {
        return { id: r.id, taskId: r.task_id };
      }
    },
  },
  notices: {
    table: "notices",
    writeAdmin: false,
    readAdmin: false,
    toRow(o) {
      return { id: o.id, data_json: JSON.stringify(o) };
    },
    fromRow(r) {
      try {
        return JSON.parse(r.data_json);
      } catch (err) {
        return { id: r.id };
      }
    },
  },
};

// 금액·단가 관련 전역 설정값만 admin 전용(비용관리·AI 인력산정 메뉴 소관).
// reviewSlaDays·reviewRollups는 에이전트 과업(공통 메뉴) 쪽이라 전원 공개.
const ADMIN_ONLY_SETTINGS = new Set([
  "rates", "aiRates", "aiStage", "aiReinvest", "aiCost", "aiInvoices", "aiScope",
]);
const ALL_SETTINGS_KEYS = [...ADMIN_ONLY_SETTINGS, "reviewSlaDays", "reviewRollups"];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env, url);
    }

    // /api/ 가 아닌데 이 스크립트까지 왔다는 건 정적 파일로 못 찾았다는 뜻.
    // ASSETS 바인딩에 그대로 넘겨 사이트의 기존 404 처리를 그대로 쓴다.
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response("Not Found", { status: 404 });
  },
};

async function handleApi(request, env, url) {
  const parts = url.pathname.split("/").filter(Boolean); // ["api", ...]

  if (url.pathname === "/api/health") return handleHealth(request, env);
  if (url.pathname === "/api/login") return handleLogin(request, env);
  if (url.pathname === "/api/logout") return handleLogout(request);
  if (url.pathname === "/api/whoami") return handleWhoami(request, env);
  if (url.pathname === "/api/state" && request.method === "GET") return handleGetState(request, env);
  if (url.pathname === "/api/migrate" && request.method === "POST") return handleMigrate(request, env);

  if (parts[1] === "settings" && parts[2]) {
    return handleSettingsRoute(request, env, decodeURIComponent(parts[2]));
  }
  if (parts[1] === "noticeActions" && !parts[2]) {
    return handleNoticeActionCreate(request, env);
  }
  if (parts[1] && ENTITIES[parts[1]]) {
    return handleEntityRoute(request, env, parts[1], parts[2] ? decodeURIComponent(parts[2]) : null);
  }

  return json({ error: "not_found", path: url.pathname }, 404);
}

async function handleHealth(request, env) {
  const result = {
    ok: true,
    service: "schedule-manager",
    time: new Date().toISOString(),
  };

  if (env.DB) {
    try {
      const row = await env.DB.prepare("SELECT 1 AS ok").first();
      result.db = row && row.ok === 1 ? "connected" : "unexpected_response";
    } catch (err) {
      result.db = "error";
      result.dbError = String(err && err.message ? err.message : err);
    }
  } else {
    result.db = "not_bound";
  }

  const session = await getSession(request, env);
  result.session = session ? { name: session.name, role: session.role } : null;

  return json(result);
}

/* ── 로그인 (M2) ────────────────────────────────────────────── */
async function handleLogin(request, env) {
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ error: "bad_request" }, 400);
  }

  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!name || !password) {
    return json({ error: "missing_fields" }, 400);
  }

  if (!env.TEAM_PASSWORD) {
    return json({ error: "server_misconfigured", message: "TEAM_PASSWORD not set" }, 500);
  }
  if (!(await safeEqual(password, env.TEAM_PASSWORD))) {
    return json({ error: "invalid_credentials" }, 401);
  }

  if (!env.DB) {
    return json({ error: "db_not_bound" }, 500);
  }
  const member = await env.DB.prepare("SELECT id, name, auth_role FROM members WHERE name = ?")
    .bind(name)
    .first();
  if (!member) {
    return json({ error: "invalid_credentials" }, 401);
  }

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    mid: member.id,
    name: member.name,
    role: member.auth_role || "member",
    exp: now + SESSION_TTL_SECONDS,
  };
  const token = await createSessionCookie(env, payload);

  const headers = new Headers({ "content-type": "application/json; charset=utf-8" });
  headers.append("Set-Cookie", buildCookie(token, SESSION_TTL_SECONDS));
  return new Response(
    JSON.stringify({ ok: true, memberId: member.id, name: member.name, role: payload.role }),
    { status: 200, headers },
  );
}

function handleLogout(request) {
  const headers = new Headers({ "content-type": "application/json; charset=utf-8" });
  headers.append("Set-Cookie", buildCookie("", 0));
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

async function handleWhoami(request, env) {
  const session = await getSession(request, env);
  if (!session) {
    return json({ error: "unauthorized" }, 401);
  }
  return json({ ok: true, memberId: session.mid, name: session.name, role: session.role });
}

/* ── 레코드 단위 CRUD (M3) ──────────────────────────────────── */

async function handleEntityRoute(request, env, entityName, id) {
  const entity = ENTITIES[entityName];
  const session = await getSession(request, env);
  if (!session) return json({ error: "unauthorized" }, 401);
  if (entity.writeAdmin && session.role !== "admin") return json({ error: "forbidden" }, 403);
  if (!env.DB) return json({ error: "db_not_bound" }, 500);

  if (request.method === "POST" && !id) return createRecord(request, env, entity, session);
  if (request.method === "PATCH" && id) return updateRecord(request, env, entity, id, session);
  if (request.method === "DELETE" && id) return deleteRecord(env, entity, id);
  return json({ error: "method_not_allowed" }, 405);
}

async function createRecord(request, env, entity, session) {
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ error: "bad_request" }, 400);
  }
  if (!body || !body.id) return json({ error: "missing_id" }, 400);

  const row = entity.toRow(body);
  const now = new Date().toISOString();
  const cols = Object.keys(row).concat(["updated_at", "updated_by"]);
  const values = Object.values(row).concat([now, session.mid]);

  try {
    await env.DB.prepare(
      `INSERT INTO ${entity.table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
    ).bind(...values).run();
  } catch (err) {
    return json({ error: "db_error", message: String(err && err.message ? err.message : err) }, 500);
  }
  return json({ ok: true, ...entity.fromRow({ ...row, updated_at: now }), updatedAt: now }, 201);
}

async function updateRecord(request, env, entity, id, session) {
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ error: "bad_request" }, 400);
  }

  const current = await env.DB.prepare(`SELECT updated_at FROM ${entity.table} WHERE id = ?`).bind(id).first();
  if (!current) return json({ error: "not_found" }, 404);
  if (body && body.ifUpdatedAt && body.ifUpdatedAt !== current.updated_at) {
    return json({ error: "conflict", currentUpdatedAt: current.updated_at }, 409);
  }

  const row = entity.toRow({ ...body, id });
  const now = new Date().toISOString();
  const setCols = Object.keys(row).filter((k) => k !== "id");
  const setClause = setCols.map((k) => `${k} = ?`).join(", ") + ", updated_at = ?, updated_by = ?";
  const values = setCols.map((k) => row[k]).concat([now, session.mid, id]);

  try {
    await env.DB.prepare(`UPDATE ${entity.table} SET ${setClause} WHERE id = ?`).bind(...values).run();
  } catch (err) {
    return json({ error: "db_error", message: String(err && err.message ? err.message : err) }, 500);
  }
  return json({ ok: true, ...entity.fromRow({ ...row, updated_at: now }), updatedAt: now });
}

async function deleteRecord(env, entity, id) {
  try {
    await env.DB.prepare(`DELETE FROM ${entity.table} WHERE id = ?`).bind(id).run();
  } catch (err) {
    return json({ error: "db_error", message: String(err && err.message ? err.message : err) }, 500);
  }
  return json({ ok: true, id });
}

/* noticeActions — 앱 자체 설계가 "추가 전용"(수정·삭제 없음)이라
   PATCH/DELETE는 아예 만들지 않는다. 자체 id도 없어 ENTITIES 밖에 둠. */
async function handleNoticeActionCreate(request, env) {
  const session = await getSession(request, env);
  if (!session) return json({ error: "unauthorized" }, 401);
  if (!env.DB) return json({ error: "db_not_bound" }, 500);
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ error: "bad_request" }, 400);
  }
  if (!body || !body.noticeId || !body.type) return json({ error: "missing_fields" }, 400);
  const at = body.at || new Date().toISOString();

  try {
    await env.DB.prepare(
      "INSERT INTO notice_actions (notice_id, type, at, updated_by) VALUES (?, ?, ?, ?)",
    ).bind(body.noticeId, body.type, at, session.mid).run();
  } catch (err) {
    return json({ error: "db_error", message: String(err && err.message ? err.message : err) }, 500);
  }
  return json({ ok: true, noticeId: body.noticeId, type: body.type, at }, 201);
}

/* ── 전역 설정값(rates·aiRates·aiStage 등) ──────────────────────
   키-값 테이블 하나에 전부 담는다(4장 settings 테이블). 쓰기는
   항상 admin 전용 — reviewSlaDays 같은 운영 규칙값도 관리자가 정함. */
async function handleSettingsRoute(request, env, key) {
  const session = await getSession(request, env);
  if (!session) return json({ error: "unauthorized" }, 401);
  if (session.role !== "admin") return json({ error: "forbidden" }, 403);
  if (!env.DB) return json({ error: "db_not_bound" }, 500);
  if (request.method !== "PATCH") return json({ error: "method_not_allowed" }, 405);
  if (!ALL_SETTINGS_KEYS.includes(key)) return json({ error: "unknown_key" }, 400);

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ error: "bad_request" }, 400);
  }

  const now = new Date().toISOString();
  try {
    await env.DB.prepare(
      `INSERT INTO settings (key, value_json, updated_at, updated_by) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    ).bind(key, JSON.stringify(body.value), now, session.mid).run();
  } catch (err) {
    return json({ error: "db_error", message: String(err && err.message ? err.message : err) }, 500);
  }
  return json({ ok: true, key, updatedAt: now });
}

/* ── GET /api/state — 통짜 읽기, 권한별 필터링 ──────────────────
   role=member면 admin 전용 메뉴 소관 데이터(expenses/contracts/
   assignments/비용·단가 settings)는 응답 자체에서 뺀다(프론트가
   숨기는 것만으론 부족 — 네트워크 레벨 차단). */
async function handleGetState(request, env) {
  const session = await getSession(request, env);
  if (!session) return json({ error: "unauthorized" }, 401);
  if (!env.DB) return json({ error: "db_not_bound" }, 500);
  const isAdmin = session.role === "admin";

  const state = {};
  for (const [key, entity] of Object.entries(ENTITIES)) {
    if (entity.readAdmin && !isAdmin) continue;
    const { results } = await env.DB.prepare(`SELECT * FROM ${entity.table}`).all();
    state[key] = results.map((r) => entity.fromRow(r, key === "members" ? { stripRate: !isAdmin } : undefined));
  }

  const na = await env.DB.prepare("SELECT notice_id, type, at FROM notice_actions ORDER BY id").all();
  state.noticeActions = na.results.map((r) => ({ noticeId: r.notice_id, type: r.type, at: r.at }));

  const settingsRows = await env.DB.prepare("SELECT key, value_json FROM settings").all();
  for (const row of settingsRows.results) {
    if (ADMIN_ONLY_SETTINGS.has(row.key) && !isAdmin) continue;
    try {
      state[row.key] = JSON.parse(row.value_json);
    } catch (err) {
      // 손상된 값은 조용히 건너뜀 — 나머지 응답까지 막지 않음
    }
  }

  return json({ ok: true, role: session.role, state });
}

/* ── POST /api/migrate — 1회성 가져오기 ─────────────────────────
   exportData()로 뽑은 JSON을 그대로 붙여넣는다. admin만, 전체를
   한 트랜잭션(batch)으로 적재 — 중간에 실패하면 전부 롤백. */
async function handleMigrate(request, env) {
  const session = await getSession(request, env);
  if (!session) return json({ error: "unauthorized" }, 401);
  if (session.role !== "admin") return json({ error: "forbidden" }, 403);
  if (!env.DB) return json({ error: "db_not_bound" }, 500);

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ error: "bad_request" }, 400);
  }
  if (!body || typeof body !== "object") return json({ error: "bad_request" }, 400);

  const now = new Date().toISOString();
  const statements = [];
  const counts = {};

  for (const [key, entity] of Object.entries(ENTITIES)) {
    const list = Array.isArray(body[key]) ? body[key] : [];
    counts[key] = 0;
    for (const item of list) {
      if (!item || !item.id) continue;
      const row = entity.toRow(item);
      const cols = Object.keys(row).concat(["updated_at", "updated_by"]);
      const values = Object.values(row).concat([now, session.mid]);
      statements.push(
        env.DB.prepare(
          `INSERT OR REPLACE INTO ${entity.table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
        ).bind(...values),
      );
      counts[key]++;
    }
  }

  const naList = Array.isArray(body.noticeActions) ? body.noticeActions : [];
  counts.noticeActions = 0;
  for (const a of naList) {
    if (!a || !a.noticeId || !a.type) continue;
    statements.push(
      env.DB.prepare("INSERT INTO notice_actions (notice_id, type, at, updated_by) VALUES (?, ?, ?, ?)")
        .bind(a.noticeId, a.type, a.at || now, session.mid),
    );
    counts.noticeActions++;
  }

  counts.settings = 0;
  for (const key of ALL_SETTINGS_KEYS) {
    if (body[key] === undefined) continue;
    statements.push(
      env.DB.prepare(
        `INSERT INTO settings (key, value_json, updated_at, updated_by) VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      ).bind(key, JSON.stringify(body[key]), now, session.mid),
    );
    counts.settings++;
  }

  if (statements.length === 0) {
    return json({ error: "empty_payload" }, 400);
  }

  try {
    await env.DB.batch(statements);
  } catch (err) {
    return json({ error: "db_error", message: String(err && err.message ? err.message : err) }, 500);
  }

  return json({ ok: true, imported: counts });
}

/* ── 세션 공용 헬퍼 ──────────────────────────────────────────── */

async function getSession(request, env) {
  return verifySessionCookie(env, getCookie(request, SESSION_COOKIE));
}

function buildCookie(token, maxAgeSeconds) {
  // Secure는 HTTPS 전제 — 운영(Cloudflare Workers)은 항상 https라 문제 없음.
  // 로컬 브라우저 테스트 시엔 영향 있을 수 있어, 로컬 검증은 curl로 한다
  // (curl은 Secure 속성을 강제하지 않음).
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
}

function getCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(/;\s*/)) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq) === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1));
      } catch (err) {
        return null;
      }
    }
  }
  return null;
}

/* ── 세션 토큰 — 서명된 무상태(stateless) 쿠키 ─────────────────────
   형식: base64url(JSON payload) + "." + base64url(HMAC-SHA256 서명)
   세션 테이블이 따로 없어, 서명만 검증하면 신뢰할 수 있다. */

async function hmacKey(env) {
  if (!env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET not set");
  }
  const raw = new TextEncoder().encode(env.SESSION_SECRET);
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

async function createSessionCookie(env, payload) {
  const key = await hmacKey(env);
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const sigBuf = await crypto.subtle.sign("HMAC", key, payloadBytes);
  return `${b64urlEncode(payloadBytes)}.${b64urlEncode(new Uint8Array(sigBuf))}`;
}

async function verifySessionCookie(env, token) {
  if (!token || !env.SESSION_SECRET) return null;
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;

  let payloadBytes, sigBytes;
  try {
    payloadBytes = b64urlDecode(token.slice(0, dot));
    sigBytes = b64urlDecode(token.slice(dot + 1));
  } catch (err) {
    return null;
  }

  let key;
  try {
    key = await hmacKey(env);
  } catch (err) {
    return null;
  }
  const valid = await crypto.subtle.verify("HMAC", key, sigBytes, payloadBytes);
  if (!valid) return null;

  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch (err) {
    return null;
  }
  if (!payload.exp || Math.floor(Date.now() / 1000) > payload.exp) return null;

  return payload;
}

/* 비밀번호 비교 — 두 문자열을 SHA-256 다이제스트(고정 32바이트)로 바꾼 뒤
   전부 훑는 비교를 해서, 문자열 직접 비교의 조기 종료로 인한 타이밍 차이를
   줄인다. 소규모 내부 도구 수준에서 적절한 선이지, 고가치 타깃을 막는
   수준의 암호학적 보장은 아니다. */
async function safeEqual(a, b) {
  const enc = new TextEncoder();
  const [da, db] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const ba = new Uint8Array(da);
  const bb = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < ba.length; i++) diff |= ba[i] ^ bb[i];
  return diff === 0;
}

function b64urlEncode(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
