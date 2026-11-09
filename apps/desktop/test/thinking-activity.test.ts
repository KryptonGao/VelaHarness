import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { ToolTrace } from "@vela/shared";
import { thinkingActivity } from "../src/renderer/components/thinking-activity.ts";
import { setActiveLocale } from "../src/renderer/locale.ts";

const call = (name: string, activity: ToolTrace["activity"] = {}, status: ToolTrace["status"] = "running"): ToolTrace => ({
  id: name, name, status, activity,
});
afterEach(() => setActiveLocale("zh-CN"));

describe("thinking activity headlines", () => {
  it("includes the operation and file, command or tool details", () => {
    setActiveLocale("zh-CN");
    const cases: [ToolTrace, string][] = [
      [call("read", { path: "src/reader.ts" }), "正在读取 · src/reader.ts"],
      [call("edit", { path: "src/editor.ts" }), "正在编辑 · src/editor.ts"],
      [call("write", { path: "src/new.ts" }), "正在创建 · src/new.ts"],
      [call("bash", { command: "pnpm test" }), "正在运行命令 · pnpm test"],
      [call("web_search", { command: "Electron docs" }), "正在使用工具 · web_search · Electron docs"],
      [call("custom", { mcp: { server: "notion", tool: "search" } }), "正在使用工具 · notion / search"],
    ];
    for (const [tool, title] of cases) {
      assert.equal(thinkingActivity([tool], true)?.title, title);
    }
  });

  it("follows the latest running call and falls back to earlier parallel work", () => {
    const first = call("read", { path: "first.ts" });
    const second = call("edit", { path: "second.ts" });
    assert.equal(thinkingActivity([first, second], true)?.kind, "edit");
    for (const status of ["done", "error"] as const) {
      assert.equal(thinkingActivity([first, { ...second, status }], true)?.kind, "read");
    }
    assert.equal(thinkingActivity([first, second], false), null);
    assert.equal(thinkingActivity([call("read", {}, "done"), call("bash", {}, "error")], true), null);
    assert.equal(thinkingActivity([], true), null);
  });

  it("handles streaming arguments without details and never uses file contents or output", () => {
    assert.equal(thinkingActivity([call("edit", { streaming: { added: 1, removed: 0 } })], true)?.title, "正在编辑");
    assert.equal(thinkingActivity([call("read", { body: "private file contents" })], true)?.title, "正在读取");
    assert.equal(thinkingActivity([call("custom", { body: "private output" })], true)?.title, "正在使用工具 · custom");
  });

  it("exposes the original call for shared rich details without copying its diff into the headline", () => {
    const tool = call("edit", { path: "src/editor.ts", diff: "+1 new\n-1 old", streaming: { added: 1, removed: 1 } });
    const activity = thinkingActivity([tool], true)!;
    assert.equal(activity.tool, tool);
    assert.equal(activity.label, "正在编辑");
    assert.equal(activity.title, "正在编辑 · src/editor.ts");
  });

  it("uses the same bash intent as the tool row for the running action", () => {
    const cases = [
      ["rg -n needle src", "正在搜索", "Searching for"],
      ["ls src", "正在列出目录", "Listing directory"],
      ["cat src/editor.ts", "正在读取", "Reading"],
      ["find src -name '*.ts'", "正在查找文件", "Searching files"],
    ];
    for (const [command, chinese, english] of cases) {
      setActiveLocale("zh-CN");
      assert.equal(thinkingActivity([call("bash", { command })], true)?.label, chinese);
      setActiveLocale("en");
      assert.equal(thinkingActivity([call("bash", { command })], true)?.label, english);
    }
  });

  it("normalizes multiline commands without losing the full detail", () => {
    const command = `pnpm test\n  && pnpm build ${"long-argument ".repeat(60)}`;
    const title = thinkingActivity([call("bash", { command })], true)?.title;
    assert.equal(title, `正在运行命令 · ${command.replace(/\s+/g, " ").trim()}`);
  });

  it("localizes all operation labels in all five interface languages", () => {
    const expected = {
      "zh-CN": ["正在读取", "正在编辑", "正在创建", "正在运行命令", "正在使用工具"],
      en: ["Reading", "Editing", "Creating", "Running commands", "Using tools"],
      "zh-TW": ["正在讀取", "正在編輯", "正在建立", "正在執行命令", "正在使用工具"],
      ja: ["読み取り中…", "編集中", "作成中", "コマンドを実行中", "ツールを使用中"],
      ko: ["읽는 중…", "편집 중", "생성 중", "명령 실행 중", "도구 사용 중"],
    };
    for (const [locale, labels] of Object.entries(expected)) {
      setActiveLocale(locale as Parameters<typeof setActiveLocale>[0]);
      ["read", "edit", "write", "bash", "custom"].forEach((name, index) => {
        assert.equal(thinkingActivity([call(name)], true)?.title, labels[index] + (name === "custom" ? " · custom" : ""));
      });
    }
  });
});
