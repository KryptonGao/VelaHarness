import assert from "node:assert/strict";
import { describe, it } from "node:test";
import worker, { incrementSql, readSql, type Env, type WorkerContext } from "../src/worker.ts";

interface Harness {
  env: Env;
  ctx: WorkerContext;
  pending: Promise<unknown>[];
  counts: Map<string, number>;
  limitKeys: string[];
  assetRequests: string[];
  settle(): Promise<void>;
}

function harness(options: { allow?: boolean; dbFails?: boolean; skills?: string[] } = {}): Harness {
  const counts = new Map<string, number>();
  const pending: Promise<unknown>[] = [];
  const limitKeys: string[] = [];
  const assetRequests: string[] = [];
  const skills = new Set(options.skills ?? ["docx", "pdf"]);
  const env: Env = {
    ASSETS: {
      async fetch(request) {
        const path = new URL(request.url).pathname;
        assetRequests.push(`${request.method} ${path}`);
        const id = /^\/v1\/skills\/([^/]+)\/manifest\.json$/.exec(path)?.[1];
        return id && skills.has(id) ? new Response(`manifest:${id}`) : new Response("missing", { status: 404 });
      },
    },
    DB: {
      prepare(query) {
        let args: unknown[] = [];
        const statement = {
          bind(...values: unknown[]) {
            args = values;
            return statement;
          },
          async run() {
            if (options.dbFails) throw new Error("d1 down");
            assert.equal(query, incrementSql);
            counts.set(String(args[0]), (counts.get(String(args[0])) ?? 0) + 1);
          },
          async all() {
            if (options.dbFails) throw new Error("d1 down");
            assert.equal(query, readSql);
            return { results: [...counts].map(([skill_id, count]) => ({ skill_id, count })) } as { results: never[] };
          },
        };
        return statement as never;
      },
    },
    INSTALL_LIMIT: {
      async limit({ key }) {
        limitKeys.push(key);
        return { success: options.allow ?? true };
      },
    },
  };
  return { env, ctx: { waitUntil: (promise) => void pending.push(promise) }, pending, counts, limitKeys, assetRequests, settle: async () => void (await Promise.all(pending)) };
}

const get = (path: string, init?: RequestInit) => new Request(`https://market.test${path}`, init);

describe("skill market worker", () => {
  it("counts one install per manifest request and returns the manifest", async () => {
    const h = harness();
    const response = await worker.fetch(get("/v1/skills/docx/manifest.json", { headers: { "cf-connecting-ip": "203.0.113.9" } }), h.env, h.ctx);
    assert.equal(await response.text(), "manifest:docx");
    await h.settle();
    assert.equal(h.counts.get("docx"), 1);
    await worker.fetch(get("/v1/skills/docx/manifest.json"), h.env, h.ctx);
    await h.settle();
    assert.equal(h.counts.get("docx"), 2);
  });

  it("does not store the caller address anywhere in the database", async () => {
    const h = harness();
    await worker.fetch(get("/v1/skills/docx/manifest.json", { headers: { "cf-connecting-ip": "203.0.113.9" } }), h.env, h.ctx);
    await h.settle();
    // 地址只交给限流计数器；D1 里只有 id 与次数。
    assert.deepEqual(h.limitKeys, ["203.0.113.9"]);
    assert.deepEqual([...h.counts], [["docx", 1]]);
  });

  it("does not count browsing: catalog, signatures, files and HEAD requests pass straight through", async () => {
    const h = harness();
    for (const path of ["/v1/catalog.json", "/v1/catalog.json.sig", "/v1/skills/docx/manifest.json.sig", "/v1/skills/docx/files/SKILL.md", "/v1/skills/docx/files/manifest.json"]) {
      await worker.fetch(get(path), h.env, h.ctx);
    }
    await worker.fetch(get("/v1/skills/docx/manifest.json", { method: "HEAD" }), h.env, h.ctx);
    await h.settle();
    assert.equal(h.counts.size, 0);
    assert.deepEqual(h.limitKeys, []);
  });

  it("does not write a row for a skill that does not exist", async () => {
    const h = harness();
    const response = await worker.fetch(get("/v1/skills/made-up/manifest.json"), h.env, h.ctx);
    assert.equal(response.status, 404);
    await h.settle();
    assert.equal(h.counts.size, 0);
  });

  it("still serves the manifest but stops counting when the rate limit is hit", async () => {
    const h = harness({ allow: false });
    const response = await worker.fetch(get("/v1/skills/docx/manifest.json"), h.env, h.ctx);
    assert.equal(await response.text(), "manifest:docx");
    await h.settle();
    assert.equal(h.counts.size, 0);
  });

  it("never lets a counting failure affect the install", async () => {
    const h = harness({ dbFails: true });
    const response = await worker.fetch(get("/v1/skills/docx/manifest.json"), h.env, h.ctx);
    assert.equal(response.status, 200);
    await h.settle();
  });

  it("serves stats as unsigned JSON with a short cache lifetime", async () => {
    const h = harness();
    await worker.fetch(get("/v1/skills/pdf/manifest.json"), h.env, h.ctx);
    await worker.fetch(get("/v1/skills/pdf/manifest.json"), h.env, h.ctx);
    await h.settle();
    const response = await worker.fetch(get("/v1/stats.json"), h.env, h.ctx);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") ?? "", /max-age=\d+/);
    assert.deepEqual(await response.json(), { schema: 1, installs: { pdf: 2 } });
  });

  it("answers stats with 503 when the database is unavailable", async () => {
    const h = harness({ dbFails: true });
    const response = await worker.fetch(get("/v1/stats.json"), h.env, h.ctx);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
  });

  it("hands everything else, including non-GET methods, to static assets", async () => {
    const h = harness();
    await worker.fetch(get("/v1/skills/docx/manifest.json", { method: "POST" }), h.env, h.ctx);
    await h.settle();
    assert.equal(h.counts.size, 0);
    assert.deepEqual(h.assetRequests, ["POST /v1/skills/docx/manifest.json"]);
  });
});
