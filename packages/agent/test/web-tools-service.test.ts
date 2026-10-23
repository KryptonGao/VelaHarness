import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { deepseekWebProvider, type WebProvider } from "@vela/shared";
import { MemoryCredentialStore } from "../src/mcp/credentials.ts";
import {
  WebToolsError,
  WebToolsService,
  isPrivateHost,
  parseFetchUrl,
  parseWebProvider,
  parseWebToolsConfig,
  readPath,
} from "../src/web-tools-service.ts";

interface Seen { method: string; url: string; headers: IncomingMessage["headers"]; body: string }
type Handler = (request: Seen, response: ServerResponse) => void;

let dir: string;
let server: Server;
let base: string;
let seen: Seen[];
let handler: Handler;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "vela-web-tools-"));
  seen = [];
  handler = (_request, response) => { response.writeHead(200, { "content-type": "application/json" }).end("{}"); };
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", chunk => chunks.push(chunk as Buffer));
    request.on("end", () => {
      const record = { method: request.method ?? "", url: request.url ?? "", headers: request.headers, body: Buffer.concat(chunks).toString("utf8") };
      seen.push(record);
      handler(record, response);
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); });
  await rm(dir, { recursive: true, force: true });
});

const local = (patch: Partial<WebProvider> = {}): WebProvider => ({
  id: "local",
  name: "Local",
  search: {
    url: `${base}/search`, method: "POST", auth: { type: "bearer" },
    body: { q: "{{query}}", limit: "{{count}}", note: "find {{query}} now" },
    resultsPath: "data.items",
    fields: { title: "name", url: "link", snippet: "desc", date: "when", source: "site.name" },
  },
  fetch: { url: `${base}/read`, method: "POST", auth: { type: "header", name: "X-Key" }, body: { target: "{{url}}" }, titlePath: "page.title", contentPath: "page.markdown" },
  ...patch,
});

function service(options: { fetch?: typeof fetch; credentials?: MemoryCredentialStore } = {}): WebToolsService {
  return new WebToolsService({ agentDir: dir, credentials: options.credentials ?? new MemoryCredentialStore(), sleep: async () => undefined, ...(options.fetch ? { fetch: options.fetch } : {}) });
}

function configured(extra: { enabled?: boolean } = {}): WebToolsService {
  const svc = service();
  svc.save({ enabled: extra.enabled ?? true, searchProviderId: "local", fetchProviderId: "local", providers: [local()] });
  svc.setApiKey("local", "sk-local-secret");
  return svc;
}

describe("configuration validation", () => {
  it("accepts the built-in DeepSeek preset", () => {
    assert.doesNotThrow(() => parseWebProvider(deepseekWebProvider, true));
  });

  it("requires https except for loopback and rejects credentials in the URL", () => {
    const withUrl = (url: string) => ({ ...local(), search: { ...local().search!, url } });
    assert.throws(() => parseWebProvider(withUrl("http://example.com/search")), /https/);
    assert.throws(() => parseWebProvider(withUrl("https://user:pass@example.com/search")), /账号|密码/);
    assert.doesNotThrow(() => parseWebProvider(withUrl("http://localhost:8888/search")));
    assert.doesNotThrow(() => parseWebProvider(withUrl("https://example.com/search")));
  });

  it("rejects unknown placeholders, a missing {{query}}, forbidden headers and bad paths", () => {
    const search = local().search!;
    assert.throws(() => parseWebProvider({ ...local(), search: { ...search, body: { q: "{{query}}", x: "{{secret}}" } } }), /secret/);
    assert.throws(() => parseWebProvider({ ...local(), search: { ...search, body: { q: "fixed" } } }), /query/);
    assert.throws(() => parseWebProvider({ ...local(), search: { ...search, headers: { Host: "evil.example" } } }), /Host/);
    assert.throws(() => parseWebProvider({ ...local(), search: { ...search, headers: { "X-A": "line\nbreak" } } }));
    assert.throws(() => parseWebProvider({ ...local(), search: { ...search, resultsPath: "a..b" } }), /路径/);
    assert.throws(() => parseWebProvider({ ...local(), search: { ...search, method: "GET", body: { q: "{{query}}" } } }), /POST/);
    assert.throws(() => parseWebProvider({ ...local(), search: { ...search, auth: { type: "header" } } }));
    assert.throws(() => parseWebProvider({ id: "x", name: "No endpoints" }), /搜索或抓取/);
  });

  it("rejects duplicate ids, built-in id reuse and selections without the capability", () => {
    const base = { enabled: true, searchProviderId: null, fetchProviderId: null };
    assert.throws(() => parseWebToolsConfig({ ...base, providers: [local(), local()] }), /已被使用/);
    assert.throws(() => parseWebToolsConfig({ ...base, providers: [{ ...local(), id: "deepseek" }] }), /已被使用/);
    assert.throws(() => parseWebToolsConfig({ ...base, providers: [local({ fetch: undefined })], fetchProviderId: "local" }), /抓取/);
    assert.throws(() => parseWebToolsConfig({ ...base, providers: [], searchProviderId: "ghost" }), /不存在/);
    assert.throws(() => parseWebToolsConfig({ ...base, providers: [], enabled: "yes" }));
  });

  it("reads dotted and indexed paths", () => {
    const value = { a: { b: [{ c: "x" }, { c: "y" }] } };
    assert.equal(readPath(value, "a.b[1].c"), "y");
    assert.equal(readPath(value, "a.b[5].c"), undefined);
    assert.equal(readPath(value, ""), value);
    assert.equal(readPath(value, "a.missing.c"), undefined);
  });
});

describe("fetch target validation", () => {
  it("accepts public http(s) pages and rejects everything else", () => {
    assert.equal(parseFetchUrl("https://example.com/a?b=1").hostname, "example.com");
    for (const bad of ["ftp://example.com", "file:///etc/passwd", "javascript:alert(1)", "not a url", "", "https://u:p@example.com", `https://example.com/${"a".repeat(9000)}`]) {
      assert.throws(() => parseFetchUrl(bad), WebToolsError, bad.slice(0, 40));
    }
  });

  it("refuses local and private network addresses", () => {
    for (const host of ["localhost", "127.0.0.1", "foo.localhost", "10.1.2.3", "192.168.0.8", "172.20.1.1", "169.254.169.254", "[::1]", "[fd00::1]", "[::ffff:7f00:1]", "nas", "printer.local", "db.internal", "0.0.0.0"]) {
      assert.equal(isPrivateHost(host), true, host);
      assert.throws(() => parseFetchUrl(`http://${host}/x`), /private|Local/, host);
    }
    for (const host of ["example.com", "8.8.8.8", "172.32.0.1", "docs.github.com"]) assert.equal(isPrivateHost(host), false, host);
  });
});

describe("storage", () => {
  it("persists configuration with owner-only permissions and reloads it", async () => {
    const credentials = new MemoryCredentialStore();
    const first = service({ credentials });
    first.save({ enabled: true, searchProviderId: "local", fetchProviderId: null, providers: [local()] });
    first.setApiKey("local", "sk-one");
    const mode = (await stat(join(dir, "web-tools.json"))).mode & 0o777;
    assert.equal(mode, 0o600);
    const file = await readFile(join(dir, "web-tools.json"), "utf8");
    assert.ok(!file.includes("sk-one"), "keys never reach the config file");
    const second = service({ credentials });
    const state = second.getState();
    assert.equal(state.enabled, true);
    assert.equal(state.searchProviderId, "local");
    assert.equal(state.providers.find(provider => provider.id === "local")?.hasKey, true);
    assert.equal(state.providers.find(provider => provider.id === "deepseek")?.hasKey, false);
    assert.ok(!JSON.stringify(state).includes("sk-one"), "state never carries keys");
  });

  it("starts disabled when the file is missing, corrupt or invalid", async () => {
    assert.equal(service().getState().enabled, false);
    await writeFile(join(dir, "web-tools.json"), "{ not json");
    assert.equal(service().getState().enabled, false);
    await writeFile(join(dir, "web-tools.json"), JSON.stringify({ version: 1, enabled: true, searchProviderId: "ghost", fetchProviderId: null, providers: [] }));
    assert.equal(service().getState().enabled, false);
    await writeFile(join(dir, "web-tools.json"), JSON.stringify({ version: 2, enabled: true, searchProviderId: null, fetchProviderId: null, providers: [] }));
    assert.equal(service().getState().enabled, false);
  });

  it("drops the key of a removed custom provider and rejects keys for unknown ones", () => {
    const svc = configured();
    assert.equal(svc.getState().providers.find(provider => provider.id === "local")?.hasKey, true);
    svc.save({ enabled: true, searchProviderId: null, fetchProviderId: null, providers: [] });
    svc.save({ enabled: true, searchProviderId: null, fetchProviderId: null, providers: [local()] });
    assert.equal(svc.getState().providers.find(provider => provider.id === "local")?.hasKey, false);
    assert.throws(() => svc.setApiKey("ghost", "k"), WebToolsError);
    assert.throws(() => svc.setApiKey("local", "   "), WebToolsError);
    assert.throws(() => svc.setApiKey("local", "a\nb"), WebToolsError);
  });

  it("reports unavailable secure storage instead of failing silently", () => {
    const broken = { withLock() { throw new Error("locked"); }, withLockAsync() { throw new Error("locked"); } };
    const svc = new WebToolsService({ agentDir: dir, credentials: broken as never });
    assert.equal(svc.getState().keysAvailable, false);
    assert.throws(() => svc.setApiKey("deepseek", "k"), (error: unknown) => error instanceof WebToolsError && error.code === "storage");
    assert.deepEqual(svc.ready(), { search: false, fetch: false });
  });

  it("notifies listeners on every change", () => {
    const svc = service();
    let count = 0;
    const off = svc.onChange(() => { count += 1; });
    svc.save({ enabled: true, searchProviderId: null, fetchProviderId: null, providers: [] });
    svc.setApiKey("deepseek", "k");
    off();
    svc.setApiKey("deepseek", null);
    assert.equal(count, 2);
  });
});

describe("readiness", () => {
  it("requires the switch, a selected provider and a key", () => {
    const svc = service();
    assert.deepEqual(svc.ready(), { search: false, fetch: false });
    svc.save({ enabled: true, searchProviderId: "local", fetchProviderId: "local", providers: [local()] });
    assert.deepEqual(svc.ready(), { search: false, fetch: false }, "no key yet");
    svc.setApiKey("local", "k");
    assert.deepEqual(svc.ready(), { search: true, fetch: true });
    svc.save({ enabled: true, searchProviderId: "local", fetchProviderId: null, providers: [local()] });
    assert.deepEqual(svc.ready(), { search: true, fetch: false });
    svc.save({ enabled: false, searchProviderId: "local", fetchProviderId: "local", providers: [local()] });
    assert.deepEqual(svc.ready(), { search: false, fetch: false });
  });

  it("does not need a key when the endpoint uses no authentication", () => {
    const open = local();
    open.search = { ...open.search!, auth: { type: "none" } };
    const svc = service();
    svc.save({ enabled: true, searchProviderId: "local", fetchProviderId: null, providers: [open] });
    assert.deepEqual(svc.ready(), { search: true, fetch: false });
  });
});

describe("search", () => {
  it("renders the request template, authenticates and maps results", async () => {
    handler = (_request, response) => response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
      data: { items: [
        { name: "One", link: "https://a.example/1", desc: "first", when: "2026-06-01", site: { name: "Site A" } },
        { name: "No link" },
        { name: "Bad scheme", link: "javascript:alert(1)" },
        { link: "https://b.example/2", desc: "untitled" },
        { name: "Three", link: "https://c.example/3" },
      ] },
    }));
    const response = await configured().search("  vela agent ", 3);
    assert.equal(seen.length, 1);
    assert.equal(seen[0]!.method, "POST");
    assert.equal(seen[0]!.url, "/search");
    assert.equal(seen[0]!.headers.authorization, "Bearer sk-local-secret");
    assert.match(seen[0]!.headers["content-type"] ?? "", /application\/json/);
    assert.deepEqual(JSON.parse(seen[0]!.body), { q: "vela agent", limit: 3, note: "find vela agent now" });
    assert.equal(response.provider, "Local");
    assert.deepEqual(response.results.map(hit => hit.url), ["https://a.example/1", "https://b.example/2", "https://c.example/3"]);
    assert.deepEqual(response.results[0], { title: "One", url: "https://a.example/1", snippet: "first", date: "2026-06-01", source: "Site A" });
    assert.equal(response.results[1]!.title, "https://b.example/2", "falls back to the URL when there is no title");
  });

  it("clamps the count and caps the number of results", async () => {
    handler = (_request, response) => response.end(JSON.stringify({ data: { items: Array.from({ length: 60 }, (_, index) => ({ name: `n${index}`, link: `https://x.example/${index}` })) } }));
    const svc = configured();
    assert.equal((await svc.search("q", 500)).results.length, 20);
    assert.equal(JSON.parse(seen.at(-1)!.body).limit, 20);
    assert.equal((await svc.search("q", 0)).results.length, 1);
    assert.equal((await svc.search("q", undefined)).results.length, 8);
  });

  it("supports GET with query templates and query-string authentication", async () => {
    handler = (_request, response) => response.end(JSON.stringify([{ title: "T", url: "https://x.example" }]));
    const provider: WebProvider = {
      id: "getter", name: "Getter",
      search: { url: `${base}/s`, method: "GET", auth: { type: "query", name: "key" }, query: { q: "{{query}}", n: "{{count}}" }, resultsPath: "", fields: { title: "title", url: "url" } },
    };
    const svc = service();
    svc.save({ enabled: true, searchProviderId: "getter", fetchProviderId: null, providers: [provider] });
    svc.setApiKey("getter", "abc 123");
    const response = await svc.search("hello world & more", 4);
    const url = new URL(seen[0]!.url, base);
    assert.equal(url.pathname, "/s");
    assert.equal(url.searchParams.get("q"), "hello world & more");
    assert.equal(url.searchParams.get("n"), "4");
    assert.equal(url.searchParams.get("key"), "abc 123");
    assert.equal(seen[0]!.body, "");
    assert.equal(response.results.length, 1);
  });

  it("validates the query and the response shape", async () => {
    const svc = configured();
    await assert.rejects(svc.search("   ", 3), (error: unknown) => error instanceof WebToolsError && error.code === "invalid");
    await assert.rejects(svc.search("x".repeat(401), 3), (error: unknown) => error instanceof WebToolsError && error.code === "invalid");
    handler = (_request, response) => response.end(JSON.stringify({ unexpected: true }));
    await assert.rejects(svc.search("q", 3), (error: unknown) => error instanceof WebToolsError && error.code === "response");
    handler = (_request, response) => response.end("<html>not json</html>");
    await assert.rejects(svc.search("q", 3), (error: unknown) => error instanceof WebToolsError && error.code === "response");
  });

  it("refuses to run when disabled, without a provider or without a key", async () => {
    const off = configured({ enabled: false });
    await assert.rejects(off.search("q", 1), (error: unknown) => error instanceof WebToolsError && error.code === "disabled");
    const none = service();
    none.save({ enabled: true, searchProviderId: null, fetchProviderId: null, providers: [] });
    await assert.rejects(none.search("q", 1), (error: unknown) => error instanceof WebToolsError && error.code === "no-provider");
    const keyless = service();
    keyless.save({ enabled: true, searchProviderId: "deepseek", fetchProviderId: null, providers: [] });
    await assert.rejects(keyless.search("q", 1), (error: unknown) => error instanceof WebToolsError && error.code === "no-key");
    assert.equal(seen.length, 0, "nothing is sent without a key");
  });
});

describe("fetch", () => {
  it("fetches through the provider and returns title and content", async () => {
    handler = (_request, response) => response.end(JSON.stringify({ page: { title: "Doc", markdown: "# Doc\n\nBody" } }));
    const response = await configured().fetch("https://example.com/article?x=1#frag");
    assert.equal(seen[0]!.headers["x-key"], "sk-local-secret");
    assert.deepEqual(JSON.parse(seen[0]!.body), { target: "https://example.com/article?x=1#frag" });
    assert.deepEqual(response, { provider: "Local", url: "https://example.com/article?x=1#frag", title: "Doc", content: "# Doc\n\nBody", truncated: false });
  });

  it("restores Markdown that the provider returned backslash-escaped, but leaves ordinary text alone", async () => {
    const escaped = "\\#\\# Date\\: 2024\\-07\\-25\n\n\\- Update API \\/chat\\/completions\n\\- JSON Mode";
    handler = (_request, response) => response.end(JSON.stringify({ page: { markdown: escaped } }));
    assert.equal((await configured().fetch("https://example.com/a")).content, "## Date: 2024-07-25\n\n- Update API /chat/completions\n- JSON Mode");
    const regex = "Use the pattern \\d+\\.\\d+ to match versions, then escape a dot as \\. only when needed.";
    handler = (_request, response) => response.end(JSON.stringify({ page: { markdown: regex } }));
    assert.equal((await configured().fetch("https://example.com/b")).content, regex);
  });

  it("truncates very long pages and flags it", async () => {
    handler = (_request, response) => response.end(JSON.stringify({ page: { markdown: "a".repeat(120_000) } }));
    const response = await configured().fetch("https://example.com/long");
    assert.equal(response.content.length, 50_000);
    assert.equal(response.truncated, true);
    assert.equal(response.title, null);
  });

  it("never sends local or invalid targets to the provider", async () => {
    const svc = configured();
    for (const target of ["http://localhost:3000", "http://192.168.1.1/admin", "file:///etc/passwd", "https://u:p@example.com"]) {
      await assert.rejects(svc.fetch(target), (error: unknown) => error instanceof WebToolsError && error.code === "invalid", target);
    }
    assert.equal(seen.length, 0);
  });

  it("reports a provider that returns no content", async () => {
    handler = (_request, response) => response.end(JSON.stringify({ page: { title: "Empty" } }));
    await assert.rejects(configured().fetch("https://example.com"), (error: unknown) => error instanceof WebToolsError && error.code === "response");
  });
});

describe("failures", () => {
  const codeFor = async (status: number): Promise<{ code: string; message: string; calls: number }> => {
    handler = (_request, response) => response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: "provider says no" } }));
    const before = seen.length;
    try {
      await configured().search("q", 1);
    } catch (error) {
      assert.ok(error instanceof WebToolsError);
      return { code: error.code, message: error.message, calls: seen.length - before };
    }
    throw new Error("expected a failure");
  };

  it("maps status codes and does not retry client errors", async () => {
    for (const [status, code] of [[400, "invalid"], [401, "auth"], [402, "balance"], [403, "blocked"], [404, "not-found"], [418, "response"]] as const) {
      const result = await codeFor(status);
      assert.equal(result.code, code, String(status));
      assert.equal(result.calls, 1, `${status} is not retried`);
    }
  });

  it("retries rate limits and server errors once", async () => {
    for (const [status, code] of [[429, "rate-limit"], [500, "network"], [503, "network"]] as const) {
      const result = await codeFor(status);
      assert.equal(result.code, code);
      assert.equal(result.calls, 2, `${status} is retried exactly once`);
    }
    let calls = 0;
    handler = (_request, response) => {
      calls += 1;
      if (calls === 1) response.writeHead(429, { "retry-after": "1" }).end("{}");
      else response.end(JSON.stringify({ data: { items: [{ name: "ok", link: "https://ok.example" }] } }));
    };
    assert.equal((await configured().search("q", 1)).results[0]!.title, "ok");
  });

  it("includes the provider's message but never the API key", async () => {
    handler = (_request, response) => response.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: "bad key sk-local-secret Bearer sk-local-secret" } }));
    await assert.rejects(configured().search("q", 1), (error: unknown) => {
      assert.ok(error instanceof WebToolsError);
      assert.ok(!error.message.includes("sk-local-secret"), error.message);
      assert.match(error.message, /401/);
      return true;
    });
  });

  it("does not follow redirects, so the key cannot leak to another host", async () => {
    handler = (_request, response) => response.writeHead(302, { location: "https://evil.example/steal" }).end();
    await assert.rejects(configured().search("q", 1), (error: unknown) => error instanceof WebToolsError && error.code === "response" && /redirect/i.test(error.message));
    assert.equal(seen.length, 1);
  });

  it("rejects oversized responses", async () => {
    handler = (_request, response) => response.end(JSON.stringify({ data: { items: [] }, pad: "x".repeat(2 * 1024 * 1024 + 10) }));
    await assert.rejects(configured().search("q", 1), (error: unknown) => error instanceof WebToolsError && error.code === "response");
  });

  it("times out slow providers and honours the caller's abort", async () => {
    const hang: typeof fetch = (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason ?? new Error("aborted")), { once: true });
    });
    const slow: WebProvider = { ...local(), search: { ...local().search!, timeoutMs: 1000 } };
    const svc = service({ fetch: hang });
    svc.save({ enabled: true, searchProviderId: "local", fetchProviderId: null, providers: [slow] });
    svc.setApiKey("local", "k");
    await assert.rejects(svc.search("q", 1), (error: unknown) => error instanceof WebToolsError && error.code === "timeout");
    const controller = new AbortController();
    const pending = svc.search("q", 1, controller.signal);
    setTimeout(() => controller.abort(new Error("stop")), 20);
    await assert.rejects(pending, /stop/);
  });

  it("reports unreachable providers", async () => {
    const down: typeof fetch = async () => { throw new TypeError("fetch failed: ECONNREFUSED sk-local-secret"); };
    const svc = service({ fetch: down });
    svc.save({ enabled: true, searchProviderId: "local", fetchProviderId: null, providers: [local()] });
    svc.setApiKey("local", "sk-local-secret");
    await assert.rejects(svc.search("q", 1), (error: unknown) => error instanceof WebToolsError && error.code === "network" && !error.message.includes("sk-local-secret"));
  });
});

describe("testing a provider", () => {
  it("works before the master switch is on and reports size and duration", async () => {
    handler = (request, response) => response.end(JSON.stringify(request.url === "/search"
      ? { data: { items: [{ name: "Hit", link: "https://hit.example" }] } }
      : { page: { title: "Example Domain", markdown: "Example body" } }));
    const svc = configured({ enabled: false });
    const search = await svc.test("local", "search");
    assert.equal(search.size, 1);
    assert.equal(search.title, "Hit");
    const fetched = await svc.test("local", "fetch");
    assert.equal(fetched.size, "Example body".length);
    assert.equal(fetched.title, "Example Domain");
    assert.ok(fetched.durationMs >= 0);
    await assert.rejects(svc.test("ghost", "search"), (error: unknown) => error instanceof WebToolsError && error.code === "no-provider");
  });
});
