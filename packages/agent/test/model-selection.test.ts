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
