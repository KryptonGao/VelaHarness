import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { workspaceFoldersInstructions } from "../src/workspace-folders.ts";

describe("workspaceFoldersInstructions", () => {
  it("没有附加资料夹时不产生提示", () => {
    assert.equal(workspaceFoldersInstructions("/work/app", []), null);
    assert.equal(workspaceFoldersInstructions("/work/app", ["/work/app"]), null);
  });

  it("列出主要资料夹与全部附加资料夹", () => {
    const text = workspaceFoldersInstructions("/work/app", ["/work/docs", "/work/app", "/work/assets"]);
    assert.ok(text);
    assert.match(text, /Primary folder.*\/work\/app/);
    assert.match(text, /- \/work\/docs/);
    assert.match(text, /- \/work\/assets/);
    assert.equal(text.match(/\/work\/app/g)?.length, 1);
  });
});
