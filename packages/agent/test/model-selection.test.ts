import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { ModelDirectory } from "../src/model-directory.ts";

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "vela-selection-"));
  dirs.push(dir);
  return dir;
}

after(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("new conversation selection settings", () => {
  it("persists the selection mode and last used choice", async () => {
    const dir = await tempDir();
    const directory = await ModelDirectory.open(dir);
    assert.deepEqual(directory.getSettings(), {
      provider: null,
      modelId: null,
      thinkingLevel: "medium",
      newConversationSelection: "default",
      instructions: "",
      subagentModels: [],
    });

    await directory.saveSettings({
      provider: null,
      modelId: null,
      thinkingLevel: "high",
      newConversationSelection: "lastUsed",
      instructions: "",
    });
    await directory.rememberLastUsed("anthropic", "claude-sonnet-4", "xhigh");

    const raw = JSON.parse(await readFile(join(dir, "selection.json"), "utf8")) as Record<string, unknown>;
    assert.equal(raw.newConversationSelection, "lastUsed");
    assert.equal(raw.thinkingLevel, "high");
    assert.deepEqual(raw.lastUsed, {
      provider: "anthropic",
      modelId: "claude-sonnet-4",
      thinkingLevel: "xhigh",
    });

    const reopened = await ModelDirectory.open(dir);
    assert.equal(reopened.getSettings().newConversationSelection, "lastUsed");
    assert.equal(reopened.getSettings().thinkingLevel, "high");
    assert.equal(reopened.lastUsedThinkingLevel(), "xhigh");
  });

  it("falls back to defaults when stored data is missing or malformed", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "selection.json"), JSON.stringify({
      thinkingLevel: "low",
      lastUsed: { provider: "openai", modelId: "", thinkingLevel: "nope" },
    }));
    const directory = await ModelDirectory.open(dir);
    assert.equal(directory.getSettings().newConversationSelection, "default");
    assert.equal(directory.getSettings().thinkingLevel, "low");
    assert.equal(directory.lastUsedThinkingLevel(), "medium");
    assert.equal(directory.availableLastUsed(), undefined);

    await writeFile(join(dir, "selection.json"), "not json");
    const broken = await ModelDirectory.open(dir);
    assert.equal(broken.getSettings().newConversationSelection, "default");
    assert.equal(broken.getSettings().thinkingLevel, "medium");
  });

  it("keeps an existing last used record when saving settings", async () => {
    const dir = await tempDir();
    const directory = await ModelDirectory.open(dir);
    await directory.rememberLastUsed("anthropic", "claude-sonnet-4", "high");
    await directory.saveSettings({
      provider: null,
      modelId: null,
      thinkingLevel: "medium",
      newConversationSelection: "lastUsed",
      instructions: "",
    });
    const reopened = await ModelDirectory.open(dir);
    assert.equal(reopened.lastUsedThinkingLevel(), "high");
    assert.equal(reopened.getSettings().newConversationSelection, "lastUsed");
  });
});

describe("same-named models from different providers", () => {
  const custom = (providerId: string, providerName: string) => ({
    providerId, providerName, baseUrl: "https://example.test/v1", api: "openai-completions" as const, apiKey: "test-key",
    modelId: "shared-id", modelName: "Shared Model", reasoning: false, contextWindow: null, maxTokens: null,
  });

  it("keeps them apart by provider and labels them with the provider only when names clash", async () => {
    const directory = await ModelDirectory.open(await tempDir());
    await directory.addCustom(custom("alpha", "Alpha"));
    const alone = directory.runtime.getModel("alpha", "shared-id")!;
    assert.equal(directory.displayName(alone), "Shared Model");

    await directory.addCustom(custom("beta", "Beta"));
    const alpha = directory.runtime.getModel("alpha", "shared-id")!;
    const beta = directory.runtime.getModel("beta", "shared-id")!;
    assert.equal(directory.displayName(alpha), "Alpha · Shared Model");
    assert.equal(directory.displayName(beta), "Beta · Shared Model");

    const selected = await directory.select("beta", "shared-id");
    assert.equal(selected.provider, "beta");
    assert.equal(directory.modelForSelection()?.provider, "beta");
    await directory.select("alpha", "shared-id");
    assert.equal(directory.modelForSelection()?.provider, "alpha");

    await directory.removeCustom("alpha", "shared-id");
    assert.equal(directory.runtime.getModel("beta", "shared-id")?.provider, "beta");
    assert.equal(directory.displayName(directory.runtime.getModel("beta", "shared-id")!), "Shared Model");
  });
});

describe("subagent model pool settings", () => {
  const base = { provider: null, modelId: null, thinkingLevel: "medium" as const, newConversationSelection: "default" as const, instructions: "" };

  it("persists the pool, dedupes it, and keeps it when a save omits the field", async () => {
    const dir = await tempDir();
    const directory = await ModelDirectory.open(dir);
    const saved = await directory.saveSettings({
      ...base,
      subagentModels: [
        { provider: "anthropic", modelId: "claude-haiku" },
        { provider: "anthropic", modelId: "claude-haiku" },
        { provider: "openrouter", modelId: "anthropic/claude-sonnet" },
      ],
    });
    assert.deepEqual(saved.subagentModels, [
      { provider: "anthropic", modelId: "claude-haiku" },
      { provider: "openrouter", modelId: "anthropic/claude-sonnet" },
    ]);

    const raw = JSON.parse(await readFile(join(dir, "selection.json"), "utf8")) as Record<string, unknown>;
    assert.equal((raw.subagentModels as unknown[]).length, 2);

    // 引导页等不关心模型池的调用方保存时不带这个字段,不能把它清空。
    await directory.saveSettings({ ...base, instructions: "Be brief" });
    assert.equal(directory.getSettings().subagentModels?.length, 2);

    const reopened = await ModelDirectory.open(dir);
    assert.equal(reopened.getSettings().subagentModels?.length, 2);

    await directory.saveSettings({ ...base, subagentModels: [] });
    const cleared = JSON.parse(await readFile(join(dir, "selection.json"), "utf8")) as Record<string, unknown>;
    assert.equal("subagentModels" in cleared, false);
  });

  it("rejects malformed or oversized pools from the UI but tolerates a damaged file", async () => {
    const dir = await tempDir();
    const directory = await ModelDirectory.open(dir);
    await assert.rejects(directory.saveSettings({ ...base, subagentModels: [{ provider: "x", modelId: "" }] }), /格式不正确/);
    const many = Array.from({ length: 33 }, (_, index) => ({ provider: "p", modelId: `m${index}` }));
    await assert.rejects(directory.saveSettings({ ...base, subagentModels: many }), /太多/);

    const invalidNote = { provider: "ok", modelId: "m", description: 123 };
    await assert.rejects(directory.saveSettings({ ...base, subagentModels: [{ ...invalidNote, description: "a".repeat(501) }] }), /模型简介/);
    await writeFile(join(dir, "selection.json"), JSON.stringify({ subagentModels: [invalidNote, { provider: 1 }, "x"] }));
    const reopened = await ModelDirectory.open(dir);
    assert.deepEqual(reopened.getSettings().subagentModels, [{ provider: "ok", modelId: "m" }]);
  });

  it("only offers pool models that are still available", async () => {
    const directory = await ModelDirectory.open(await tempDir());
    await directory.saveSettings({ ...base, subagentModels: [{ provider: "ghost", modelId: "missing" }] });
    assert.deepEqual(directory.availableSubagentModels(), []);
  });
});

describe("custom model reasoning efforts", () => {
  const input = {
    providerId: "custom-efforts", providerName: "Custom", baseUrl: "http://127.0.0.1:1/v1",
    api: "openai-completions" as const, apiKey: "test", modelId: "local", modelName: "",
    reasoning: true, contextWindow: null, maxTokens: null,
  };

  it("sends xhigh, clamps missing levels and clears all efforts", async () => {
    const dir = await tempDir();
    const directory = await ModelDirectory.open(dir);
    await directory.addCustom({ ...input, reasoningEfforts: ["max", "xhigh", "low"] });
    const reopened = await ModelDirectory.open(dir);
    const model = reopened.requireAvailable(input.providerId, input.modelId);
    let sentEffort: unknown;
    await reopened.runtime.completeSimple(model, { messages: [{ role: "user", content: "test", timestamp: 1 }] }, {
      reasoning: "xhigh",
      onPayload(payload) {
        sentEffort = (payload as { reasoning_effort?: unknown }).reasoning_effort;
        throw new Error("Captured the request before transmission");
      },
    });
    assert.equal(sentEffort, "xhigh");
    const summary = (await reopened.catalog()).models.find(item => item.provider === input.providerId)!;
    assert.deepEqual(summary.reasoningEfforts, ["low", "xhigh", "max"]);
    assert.deepEqual(summary.thinkingLevels, ["low", "xhigh", "max", "ultra"]);
    const settings = await reopened.saveSettings({ ...reopened.getSettings(), provider: input.providerId, modelId: input.modelId, thinkingLevel: "medium" });
    assert.equal(settings.thinkingLevel, "xhigh");
    await directory.addCustom({ ...input, baseUrl: "http://127.0.0.1:2/v1" });
    assert.equal(directory.requireAvailable(input.providerId, input.modelId).thinkingLevelMap?.xhigh, "xhigh");
    await directory.addCustom({ ...input, reasoningEfforts: [] });
    const cleared = (await directory.catalog()).models.find(item => item.provider === input.providerId)!;
    assert.equal(cleared.reasoning, false);
    assert.deepEqual(cleared.thinkingLevels, ["off", "ultra"]);
    assert.deepEqual(cleared.reasoningEfforts, []);
  });

  it("normalizes an already saved extra-high alias when the model is saved again", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "models.json"), JSON.stringify({ providers: {
      [input.providerId]: { api: input.api, baseUrl: input.baseUrl, apiKey: input.apiKey,
        models: [{ id: input.modelId, reasoning: true, thinkingLevelMap: { xhigh: "extra", low: null } }] },
    } }));
    const directory = await ModelDirectory.open(dir);
    await directory.addCustom(input);
    assert.deepEqual(directory.requireAvailable(input.providerId, input.modelId).thinkingLevelMap, { xhigh: "xhigh", low: null });
  });

  it("keeps the SDK defaults for legacy models and rejects noncanonical efforts", async () => {
    const directory = await ModelDirectory.open(await tempDir());
    await directory.addCustom(input);
    const summary = (await directory.catalog()).models.find(item => item.provider === input.providerId)!;
    assert.deepEqual(summary.reasoningEfforts, ["low", "medium", "high"]);
    assert.ok(summary.thinkingLevels.includes("minimal"));
    for (const alias of ["extra", "extra high"]) {
      // @ts-expect-error Validate raw values from untyped clients.
      await assert.rejects(directory.addCustom({ ...input, reasoningEfforts: [alias] }), /不支持这个思考强度/);
    }
    assert.equal(directory.requireAvailable(input.providerId, input.modelId).thinkingLevelMap, undefined);
  });
});
