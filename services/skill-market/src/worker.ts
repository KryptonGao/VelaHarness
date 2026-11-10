/**
 * Vela Skill Market 的 Worker。
 *
 * 目录、manifest 和 Skill 文件都是已签名的静态内容，由 Static Assets 提供；
 * 只有两条路由经过这里：
 *   GET /v1/skills/:id/manifest.json  回传 manifest，并给该 Skill 的安装次数加 1
 *   GET /v1/stats.json                回传各 Skill 的安装次数（不签名，只用于展示）
 * 除此之外的请求原样交给 Static Assets。
 *
 * 不依赖 @cloudflare/workers-types，只声明用到的那几个接口，方便在 Node 里直接测试。
 */

export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  run(): Promise<unknown>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  DB: { prepare(query: string): D1Statement };
  INSTALL_LIMIT: { limit(options: { key: string }): Promise<{ success: boolean }> };
}

export interface WorkerContext {
  waitUntil(promise: Promise<unknown>): void;
}

const manifestRoute = /^\/v1\/skills\/([a-z0-9][a-z0-9-]{0,63})\/manifest\.json$/;
const statsCacheSeconds = 300;

/** 安装次数的存储与读取都集中在这里，Worker 以外没有别的代码碰 D1。 */
export const incrementSql =
  "INSERT INTO install_counts (skill_id, count) VALUES (?, 1) ON CONFLICT(skill_id) DO UPDATE SET count = count + 1";
export const readSql = "SELECT skill_id, count FROM install_counts ORDER BY skill_id";

async function countInstall(env: Env, id: string, request: Request): Promise<void> {
  try {
    // 速率限制只用来防止刷量：key 只进 Cloudflare 的限流计数器，不写进 D1，也不记录。
    const key = request.headers.get("cf-connecting-ip") ?? "unknown";
    const { success } = await env.INSTALL_LIMIT.limit({ key });
    if (!success) return;
    await env.DB.prepare(incrementSql).bind(id).run();
  } catch (error) {
    // 计数失败不能影响安装。
    console.error("install count failed", error instanceof Error ? error.message : error);
  }
}

async function stats(request: Request, env: Env, ctx: WorkerContext): Promise<Response> {
  // 缓存键只看路径：带不同查询串的请求共用同一份缓存，没法借此绕过缓存反复读 D1。
  const cacheKey = new Request(`${new URL(request.url).origin}/v1/stats.json`);
  const edgeCache = (globalThis as { caches?: { default?: { match(r: Request): Promise<Response | undefined>; put(r: Request, v: Response): Promise<void> } } }).caches?.default;
  const cached = await edgeCache?.match(cacheKey).catch(() => undefined);
  if (cached) return cached;
  let results: { skill_id: string; count: number }[];
  try {
    ({ results } = await env.DB.prepare(readSql).all<{ skill_id: string; count: number }>());
  } catch {
    return new Response(JSON.stringify({ error: "unavailable" }), {
      status: 503,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }
  const installs: Record<string, number> = {};
  for (const row of results) installs[row.skill_id] = row.count;
  const response = new Response(`${JSON.stringify({ schema: 1, installs })}\n`, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${statsCacheSeconds}`,
    },
  });
  if (edgeCache) ctx.waitUntil(edgeCache.put(cacheKey, response.clone()).catch(() => undefined));
  return response;
}

export default {
  async fetch(request: Request, env: Env, ctx: WorkerContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "GET" && request.method !== "HEAD") return env.ASSETS.fetch(request);

    if (url.pathname === "/v1/stats.json") return stats(request, env, ctx);

    const match = manifestRoute.exec(url.pathname);
    if (match) {
      const response = await env.ASSETS.fetch(request);
      // 只有真实存在的 Skill 才计数，随便拼一个 id 不会往表里写东西；HEAD 不算安装。
      if (request.method === "GET" && response.status === 200) ctx.waitUntil(countInstall(env, match[1] as string, request));
      return response;
    }

    return env.ASSETS.fetch(request);
  },
};
