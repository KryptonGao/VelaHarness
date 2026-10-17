import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { describe, it } from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !specifier.endsWith(".ts") && !specifier.endsWith(".js")) {
      try {
        return nextResolve(`${specifier}.ts`, context);
      } catch {
        // 回退到默认解析
      }
    }
    return nextResolve(specifier, context);
  },
});

const { mergeGitFileLists } = await import("../src/file-service.ts");

const nul = (...paths: string[]) => paths.map((path) => `${path}\0`).join("");

describe("mergeGitFileLists", () => {
  it("已跟踪文件优先于未跟踪文件占用名额", () => {
    const merged = mergeGitFileLists(nul("StudyPulse/App.swift", "README.md"), nul("Aaa/new.txt", "Zzz/new.txt"), 3);
    assert.deepEqual(merged.files, ["StudyPulse/App.swift", "README.md", "Aaa/new.txt"]);
    assert.equal(merged.truncated, true);
  });

  it("忽略未跟踪的 DerivedData 构建目录,保留其他目录", () => {
    const merged = mergeGitFileLists(
      nul("StudyPulse/App.swift"),
      nul("DerivedDataBuild/a.o", "DerivedDataBuildCQ01/b/c.o", "docs/new.md"),
      10,
    );
    assert.deepEqual(merged.files, ["StudyPulse/App.swift", "docs/new.md"]);
    assert.equal(merged.truncated, false);
  });

  it("已跟踪的 DerivedData 路径仍然保留", () => {
    const merged = mergeGitFileLists(nul("DerivedDataTools/run.sh"), "", 10);
    assert.deepEqual(merged.files, ["DerivedDataTools/run.sh"]);
  });
});
