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
 * M1: /api/health (DB 바인딩 확인용) — 로그인·CRUD 없음.
 * M2(이 커밋): /api/login, /api/logout, /api/whoami — 세션 쿠키 발급·검증.
 *   세션은 서버에 저장하지 않는 무상태(stateless) 서명 토큰이다
 *   (PHASE2_DESIGN.md 3장). 레코드 CRUD는 M3~M4에서 추가된다.
 */

const SESSION_COOKIE = "sm_session";
// 30일 — PHASE2_DESIGN.md 3.3: 우선 이 값으로 구현, 최종 기간은 추후 재검토.
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

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
  if (url.pathname === "/api/health") {
    return handleHealth(request, env);
  }
  if (url.pathname === "/api/login") {
    return handleLogin(request, env);
  }
  if (url.pathname === "/api/logout") {
    return handleLogout(request);
  }
  if (url.pathname === "/api/whoami") {
    return handleWhoami(request, env);
  }

  // M3(레코드 CRUD) 이후 여기에 라우트를 추가한다.
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

  const session = await verifySessionCookie(env, getCookie(request, SESSION_COOKIE));
  result.session = session ? { name: session.name, role: session.role } : null;

  return json(result);
}

/* ── 로그인 ──────────────────────────────────────────────────────
   PHASE2_DESIGN.md 3.1: 이름 선택 + 팀 공용 비밀번호.
   비밀번호는 Workers Secret(TEAM_PASSWORD)과 대조하고, 이름은 D1의
   members 테이블에서 찾는다(실제 데이터는 M3 마이그레이션에서 채워짐).
   둘 중 뭐가 틀렸는지는 응답에서 구분하지 않는다(계정 존재 여부 노출 방지). */
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
  const session = await verifySessionCookie(env, getCookie(request, SESSION_COOKIE));
  if (!session) {
    return json({ error: "unauthorized" }, 401);
  }
  return json({ ok: true, memberId: session.mid, name: session.name, role: session.role });
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
