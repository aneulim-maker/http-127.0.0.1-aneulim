/*
 * eulim-site Worker — schedule-manager Phase 2 (M1: 라우팅 뼈대)
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
 * M1 범위: 로그인·DB 쿼리 없음. /api/health 하나만 응답하고,
 * D1 바인딩(env.DB)이 연결돼 있으면 그것도 같이 확인한다.
 * 로그인/세션/레코드별 CRUD는 M2~M3에서 이 라우터에 추가된다.
 */

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

  // M2(로그인) · M3(레코드 CRUD) 이후 여기에 라우트를 추가한다.
  // 예: if (url.pathname === "/api/login" && request.method === "POST") { ... }

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

  return json(result);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
