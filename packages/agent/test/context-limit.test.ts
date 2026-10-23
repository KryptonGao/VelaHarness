import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { compactionTokensForLimit, effectiveContextWindow, parseContextLimitSettings, readContextLimitSettings } from "@vela/shared";
import { ContextLimitSettingsStore } from "../src/context-limit-settings.ts";

const defaults = { reserveTokens: 16384, keepRecentTokens: 20000 };

describe("上下文长度限制", () => {
  it("校验输入：null 表示不限，越界与非数字抛错", () => {
    assert.deepEqual(parseContextLimitSettings({ limitTokens: null }), { limitTokens: null });
    assert.deepEqual(parseContextLimitSettings({ limitTokens: 64_000 }), { limitTokens: 64_000 });
    assert.throws(() => parseContextLimitSettings({ limitTokens: 1000 }), /超出范围/);
    assert.throws(() => parseContextLimitSettings({ limitTokens: 20_000_000 }), /超出范围/);
    assert.throws(() => parseContextLimitSettings({ limitTokens: "64" }), /必须是数字/);
    assert.throws(() => parseContextLimitSettings(null), /不正确/);
  });

  it("磁盘上的坏值回到不限制", () => {
    assert.deepEqual(readContextLimitSettings({ limitTokens: 5 }), { limitTokens: null });
    assert.deepEqual(readContextLimitSettings("x"), { limitTokens: null });
  });

  it("有效窗口取模型窗口与上限的较小者", () => {
    assert.equal(effectiveContextWindow(200_000, 64_000), 64_000);
    assert.equal(effectiveContextWindow(32_000, 64_000), 32_000);
    assert.equal(effectiveContextWindow(200_000, null), 200_000);
    assert.equal(effectiveContextWindow(0, 64_000), 0);
  });

  it("上限收窄窗口时按比例缩小压缩参数，否则沿用默认", () => {
    assert.deepEqual(compactionTokensForLimit(200_000, 32_000, defaults), { reserveTokens: 8000, keepRecentTokens: 12_800 });
    assert.deepEqual(compactionTokensForLimit(200_000, 128_000, defaults), { reserveTokens: 16384, keepRecentTokens: 20000 });
    assert.equal(compactionTokensForLimit(200_000, null, defaults), null);
    assert.equal(compactionTokensForLimit(32_000, 64_000, defaults), null);
  });

  it("设置持久化后重新读取", () => {
    const dir = mkdtempSync(join(tmpdir(), "vela-context-limit-"));
    const store = new ContextLimitSettingsStore(dir);
    assert.deepEqual(store.settings, { limitTokens: null });
    store.save({ limitTokens: 128_000 });
    assert.deepEqual(new ContextLimitSettingsStore(dir).settings, { limitTokens: 128_000 });
    assert.throws(() => store.save({ limitTokens: 1 }));
    assert.deepEqual(store.settings, { limitTokens: 128_000 });
  });

  it("损坏的设置文件回到不限制", () => {
    const dir = mkdtempSync(join(tmpdir(), "vela-context-limit-"));
    writeFileSync(join(dir, "context-limit-settings.json"), "{broken");
    assert.deepEqual(new ContextLimitSettingsStore(dir).settings, { limitTokens: null });
  });
});
