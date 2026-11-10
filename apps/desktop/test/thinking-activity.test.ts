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
  it("shows only the operation without file, command or tool details", () => {
    setActiveLocale("zh-CN");
    const cases: [ToolTrace, string][] = [
      [call("read", { path: "src/reader.ts" }), "正在读取文件"],
      [call("edit", { path: "src/editor.ts" }), "正在编辑文件"],
      [call("write", { path: "src/new.ts" }), "正在创建文件"],
      [call("bash", { command: "pnpm test" }), "正在运行命令"],
      [call("web_search", { command: "Electron docs" }), "正在使用工具"],
      [call("custom", { mcp: { server: "notion", tool: "search" } }), "正在使用工具"],
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
    assert.equal(thinkingActivity([call("edit", { streaming: { added: 1, removed: 0 } })], true)?.title, "正在编辑文件");
    assert.equal(thinkingActivity([call("read", { body: "private file contents" })], true)?.title, "正在读取文件");
    assert.equal(thinkingActivity([call("custom", { body: "private output" })], true)?.title, "正在使用工具");
  });

  it("retains the original call for activity identity without copying its details into the headline", () => {
    const tool = call("edit", { path: "src/editor.ts", diff: "+1 new\n-1 old", streaming: { added: 1, removed: 1 } });
    const activity = thinkingActivity([tool], true)!;
    assert.equal(activity.tool, tool);
    assert.equal(activity.label, "正在编辑文件");
    assert.equal(activity.title, "正在编辑文件");
  });

  it("uses one short operation label for every bash intent", () => {
    for (const command of ["rg -n needle src", "ls src", "cat src/editor.ts", "find src -name '*.ts'"]) {
      setActiveLocale("zh-CN");
      assert.equal(thinkingActivity([call("bash", { command })], true)?.label, "正在运行命令");
      setActiveLocale("en");
      assert.equal(thinkingActivity([call("bash", { command })], true)?.label, "Running commands");
    }
  });

  it("keeps long multiline commands out of the title", () => {
    const command = `pnpm test\n  && pnpm build ${"long-argument ".repeat(60)}`;
    assert.equal(thinkingActivity([call("bash", { command })], true)?.title, "正在运行命令");
  });

  it("localizes all operation labels in all five interface languages", () => {
    const expected = {
      "zh-CN": ["正在读取文件", "正在编辑文件", "正在创建文件", "正在运行命令", "正在使用工具"],
      en: ["Reading files", "Editing files", "Creating files", "Running commands", "Using tools"],
      "zh-TW": ["正在讀取檔案", "正在編輯檔案", "正在建立檔案", "正在執行命令", "正在使用工具"],
      ja: ["ファイルを読み取り中", "ファイルを編集中", "ファイルを作成中", "コマンドを実行中", "ツールを使用中"],
      ko: ["파일 읽는 중", "파일 편집 중", "파일 생성 중", "명령 실행 중", "도구 사용 중"],
    };
    for (const [locale, labels] of Object.entries(expected)) {
      setActiveLocale(locale as Parameters<typeof setActiveLocale>[0]);
      ["read", "edit", "write", "bash", "custom"].forEach((name, index) => {
        assert.equal(thinkingActivity([call(name)], true)?.title, labels[index]);
      });
    }
  });
});
