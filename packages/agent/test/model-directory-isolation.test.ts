import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { ModelConfigReadOnlyError, ModelDirectory } from "../src/model-directory.ts";
import { AgentRuntime } from "../src/runtime.ts";

let root: string;
let configDir: string;
let cacheDir: string;

const customModels = {
  providers: {
    "iso-local": {
      name: "Isolation fixture",
      baseUrl: "http://127.0.0.1:1/v1",
      api: "openai-completions",
      apiKey: "synthetic-test-key",
      models: [{ id: "iso-model", name: "Iso", api: "openai-completions", reasoning: false, contextWindow: 8192, maxTokens: 1024 }],
    },
  },
};
const selection = { provider: "iso-local", modelId: "iso-model", thinkingLevel: "off", newConversationSelection: "default", instructions: "" };

/** 目录里每个文件的内容，用来断言「没有被动过」。 */
async function snapshot(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const name of await readdir(dir).catch(() => [])) out[name] = await readFile(join(dir, name), "utf8").catch(() => "<dir>");
  return out;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "vela-model-iso-"));
  configDir = join(root, "config");
  cacheDir = join(root, "run", "cache");
  await mkdir(configDir, { recursive: true });
  await writeFile(join(configDir, "models.json"), JSON.stringify(customModels));
  await writeFile(join(configDir, "selection.json"), JSON.stringify(selection));
});
afterEach(() => rm(root, { recursive: true, force: true }));

const open = (extra: Partial<Parameters<typeof ModelDirectory.open>[1] & object> = {}) =>
  ModelDirectory.open(join(root, "ignored-agent-dir"), { configDir, cacheDir, readOnlyConfig: true, refreshCatalogOnStart: false, ...extra });

describe("model directory with separate config and cache", () => {
  it("reads models and the default selection from the config directory", async () => {
    const directory = await open();
    assert.equal(directory.selection.provider, "iso-local");
    assert.equal(directory.availableSelection()?.id, "iso-model");
    assert.ok(directory.isAvailable({ provider: "iso-local", id: "iso-model" }));
  });

  it("keeps the model catalog cache in the cache directory and seeds it from the source cache", async () => {
    await writeFile(join(configDir, "models-store.json"), JSON.stringify({ seeded: true }));
    const before = await snapshot(configDir);
    await open();
    assert.equal(JSON.parse(await readFile(join(cacheDir, "models-store.json"), "utf8")).seeded, true);
    // Pi's credential store may add an empty auth.json; nothing that exists is rewritten.
    const after = await snapshot(configDir);
    if ("auth.json" in after) { assert.equal(after["auth.json"], "{}"); delete after["auth.json"]; }
    assert.deepEqual(after, before, "opening must not change the existing config files");
    await assert.rejects(stat(join(cacheDir, "auth.json")), "credentials are never copied");
    await assert.rejects(stat(join(root, "ignored-agent-dir", "models.json")));
  });

  it("does not write model definitions or a default selection into a missing config directory", async () => {
    const missing = join(root, "no-such-config");
    const directory = await ModelDirectory.open(join(root, "agent"), { configDir: missing, cacheDir, readOnlyConfig: true, refreshCatalogOnStart: false });
    assert.equal(directory.availableSelection(), undefined);
    const names = await readdir(missing).catch(() => []);
    assert.ok(names.every(name => name === "auth.json"), `unexpected files: ${names.join(", ")}`);
  });

  it("rejects every config mutation when read-only and leaves the files byte-identical", async () => {
    const directory = await open();
    const before = await snapshot(configDir);
    const model = directory.requireAvailable("iso-local", "iso-model");
    await assert.rejects(directory.select("iso-local", "iso-model"), ModelConfigReadOnlyError);
    await assert.rejects(directory.setThinkingLevel("low", model), ModelConfigReadOnlyError);
    await assert.rejects(directory.saveSettings({ ...directory.getSettings(), thinkingLevel: "low" }), ModelConfigReadOnlyError);
    await assert.rejects(directory.addCustom({ providerId: "x", modelId: "y", baseUrl: "http://127.0.0.1:2/v1", api: "openai-completions", apiKey: "k", reasoning: false }), ModelConfigReadOnlyError);
    await assert.rejects(directory.removeCustom("iso-local", "iso-model"), ModelConfigReadOnlyError);
    await assert.rejects(directory.logout("iso-local"), ModelConfigReadOnlyError);
    await assert.rejects(directory.login("openai-codex", "oauth"), ModelConfigReadOnlyError);
    await directory.rememberLastUsed("iso-local", "iso-model", "low");
    assert.deepEqual(await snapshot(configDir), before);
  });

  it("is writable when not read-only, writing selection to the config directory only", async () => {
    const directory = await open({ readOnlyConfig: false });
    await directory.setThinkingLevel("low", undefined);
    assert.equal(JSON.parse(await readFile(join(configDir, "selection.json"), "utf8")).thinkingLevel, "low");
    await assert.rejects(stat(join(cacheDir, "selection.json")));
  });

  it("skips the startup catalog refresh unless asked", async () => {
    const saved = process.env.PI_OFFLINE;
    delete process.env.PI_OFFLINE;
    try {
      for (const [refresh, expected] of [[false, 0], [undefined, 1]] as const) {
        const directory = await open({ refreshCatalogOnStart: refresh });
        let calls = 0;
        directory.runtime.refresh = (async () => { calls += 1; return { aborted: false, errors: new Map() }; }) as typeof directory.runtime.refresh;
        directory.refreshCatalogFromNetwork();
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(calls, expected, `refreshCatalogOnStart=${String(refresh)}`);
      }
    } finally {
      if (saved === undefined) delete process.env.PI_OFFLINE;
      else process.env.PI_OFFLINE = saved;
    }
  });

  it("lets Pi refresh an expiring OAuth token into the source auth.json even when config is read-only", async () => {
    const claims = Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acct-refreshed" } })).toString("base64url");
    const refreshedAccess = `e30.${claims}.fresh`;
    await writeFile(join(configDir, "auth.json"), JSON.stringify({
      "openai-codex": { type: "oauth", access: "stale-access", refresh: "old-refresh", expires: Date.now() - 60_000, accountId: "acct-old" },
    }));
    const directory = await open();
    const realFetch = globalThis.fetch;
    const seen: string[] = [];
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      seen.push(String(input));
      return new Response(JSON.stringify({ access_token: refreshedAccess, refresh_token: "new-refresh", expires_in: 3600 }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    try {
      const auth = await directory.runtime.getAuth("openai-codex");
      assert.equal(auth?.auth.apiKey, refreshedAccess);
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.ok(seen.some(url => url.includes("oauth/token")), "the refresh endpoint was called");
    const stored = JSON.parse(await readFile(join(configDir, "auth.json"), "utf8"));
    assert.equal(stored["openai-codex"].refresh, "new-refresh", "the rotated refresh token lands in the source auth.json, not in a stale copy");
    await assert.rejects(stat(join(cacheDir, "auth.json")));
  });
});

describe("AgentRuntime with a separate model directory", () => {
  it("keeps the catalog cache in the run data directory by default and never writes the config directory", async (t) => {
    await writeFile(join(configDir, "models-store.json"), JSON.stringify({ seeded: true }));
    const agentDir = join(root, "agent");
    const before = await snapshot(configDir);
    const runtime = new AgentRuntime({ cwd: root, agentDir, modelDirectory: { configDir, readOnlyConfig: true, refreshCatalogOnStart: false } });
    t.after(() => runtime.dispose());
    const { conversationId } = await runtime.createRunConversation({ cwd: root, sandboxMode: "ask" });
    assert.ok(conversationId);
    assert.equal(JSON.parse(await readFile(join(agentDir, "model-cache", "models-store.json"), "utf8")).seeded, true);
    const after = await snapshot(configDir);
    if ("auth.json" in after) delete after["auth.json"];
    assert.deepEqual(after, before);
    // The conversation index lives with the run data, not the config.
    await runtime.persistStrict();
    assert.ok((await readdir(agentDir)).includes("conversations.json"));
    await assert.rejects(stat(join(configDir, "conversations.json")));
  });
});
