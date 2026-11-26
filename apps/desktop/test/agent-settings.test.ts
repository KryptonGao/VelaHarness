import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { maxSubagentModelDescriptionLength } from "@vela/shared";
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

  it("validates and persists naming style, preserving the selection on unrelated saves", async t => {
    const dir = await mkdtemp(join(tmpdir(), "vela-agent-naming-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const directory = await ModelDirectory.open(dir);
    for (const bad of ["other", null, 1]) {
      assert.throws(() => parseAgentSettings({ ...base, subagentNamingStyle: bad }), /命名风格/);
    }
    assert.ok(!("subagentNamingStyle" in parseAgentSettings(base)));
    for (const style of ["artistic", "practical"]) {
      await directory.saveSettings(parseAgentSettings({ ...base, subagentNamingStyle: style }));
      await directory.saveSettings(parseAgentSettings({ ...base, instructions: "Be brief" }));
      assert.equal((await ModelDirectory.open(dir)).getSettings().subagentNamingStyle, style);
    }
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

  it("bounds model descriptions and omits whitespace-only notes", () => {
    const ref = { provider: "p", modelId: "m" };
    const parse = (description: unknown) => parseAgentSettings({ ...base, subagentModels: [{ ...ref, description }] }).subagentModels;
    const max = "a".repeat(maxSubagentModelDescriptionLength);
    assert.deepEqual(parse(max), [{ ...ref, description: max }]);
    assert.deepEqual(parse(" \r\n "), [ref]);
    for (const bad of [max + "a", 42, null]) assert.throws(() => parse(bad), /模型简介/);
  });

  it("a pool saved through the parser comes back from the stored settings", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vela-agent-settings-"));
    try {
      const directory = await ModelDirectory.open(dir);
      const ref = { provider: "anthropic", modelId: "claude-haiku", thinkingLevels: ["low", "high"] };
      const note = "适合快速查阅\n成本较低";
      const saveNote = (description: string) => directory.saveSettings(parseAgentSettings({ ...base, subagentModels: [{ ...ref, description }] }));
      const saved = await saveNote(`  ${note}  `);
      assert.deepEqual(saved.subagentModels, [{ ...ref, description: note }]);
      await directory.saveSettings(parseAgentSettings({ ...base, instructions: "Be brief" }));
      assert.deepEqual((await ModelDirectory.open(dir)).getSettings().subagentModels, saved.subagentModels);
      await saveNote("");
      assert.deepEqual((await ModelDirectory.open(dir)).getSettings().subagentModels, [ref]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
