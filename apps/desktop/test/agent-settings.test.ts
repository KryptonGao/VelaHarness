import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { ModelDirectory } from "../../../packages/agent/src/model-directory.ts";
import { parseAgentSettings } from "../src/main/agent-settings.ts";

const base = { provider: null, modelId: null, thinkingLevel: "medium", newConversationSelection: "default", instructions: "" };

describe("parseAgentSettings (IPC boundary)", () => {
  it("keeps the subagent model pool instead of silently dropping it", () => {
    const pool = [{ provider: "anthropic", modelId: "claude-haiku" }, { provider: "openrouter", modelId: "anthropic/claude-sonnet" }];
    assert.deepEqual(parseAgentSettings({ ...base, subagentModels: pool }).subagentModels, pool);
    assert.deepEqual(parseAgentSettings({ ...base, subagentModels: [] }).subagentModels, []);
  });

  it("leaves the field out when the caller did not send it, so the stored pool is kept", () => {
    assert.equal("subagentModels" in parseAgentSettings(base), false);
  });

  it("rejects malformed or oversized pools", () => {
    for (const bad of ["x", [null], [{ provider: "a" }], [{ provider: "", modelId: "m" }], Array.from({ length: 33 }, (_, i) => ({ provider: "p", modelId: `m${i}` }))]) {
      assert.throws(() => parseAgentSettings({ ...base, subagentModels: bad }), /子代理模型池不正确|模型不正确/);
    }
  });

  it("rejects empty and unknown reasoning effort choices", () => {
    for (const levels of [[], ["turbo"], null, "low"]) {
      assert.throws(() => parseAgentSettings({ ...base, subagentModels: [{ provider: "p", modelId: "m", thinkingLevels: levels }] }), /推理强度/);
    }
  });

  it("a pool saved through the parser comes back from the stored settings", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vela-agent-settings-"));
    try {
      const directory = await ModelDirectory.open(dir);
      const pool = [{ provider: "anthropic", modelId: "claude-haiku", thinkingLevels: ["low", "high"] }];
      const saved = await directory.saveSettings(parseAgentSettings({ ...base, subagentModels: pool }));
      assert.deepEqual(saved.subagentModels, pool);
      await directory.saveSettings(parseAgentSettings({ ...base, instructions: "Be brief" }));
      assert.deepEqual((await ModelDirectory.open(dir)).getSettings().subagentModels, pool);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
