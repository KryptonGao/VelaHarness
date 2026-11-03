import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  firstCodeLine,
  lastBrowserUrl,
  parsePageSnapshot,
  shortenUrl,
  splitBrowserBody,
  summarizeBrowserCode,
} from "../src/renderer/components/browser-call.ts";

describe("summarizeBrowserCode", () => {
  it("reads goto and screenshot in order", () => {
    const steps = summarizeBrowserCode(`const tab = browser.tabs.selected();
await tab.goto("http://localhost:8731/index.html");
nodeRepl.emitImage(await tab.screenshot());`);
    assert.deepEqual(steps, [
      { kind: "open", target: "localhost:8731/index.html" },
      { kind: "screenshot", target: "" },
    ]);
  });

  it("falls back to connect, then script", () => {
    assert.deepEqual(summarizeBrowserCode(`const browser = await agent.browsers.get("iab");`), [{ kind: "connect", target: "" }]);
    assert.deepEqual(summarizeBrowserCode("1 + 1"), [{ kind: "script", target: "" }]);
    assert.deepEqual(summarizeBrowserCode(undefined), [{ kind: "script", target: "" }]);
  });

  it("merges repeated actions and caps the chain", () => {
    const steps = summarizeBrowserCode(`await a.fill("x"); await a.type("y"); await a.click("Go"); await a.snapshot(); await a.console();`);
    assert.deepEqual(steps.map((step) => step.kind), ["input", "click", "snapshot"]);
    assert.equal(steps[1]?.target, "Go");
  });
});

describe("browser helpers", () => {
  it("splits screenshots from text output", () => {
    const image = "data:image/png;base64,AAAA";
    const { screenshots, output } = splitBrowserBody(`done\n\n![Browser screenshot](${image})`);
    assert.deepEqual(screenshots, [image]);
    assert.equal(output, "done");
  });

  it("shortens urls", () => {
    assert.equal(shortenUrl("https://www.example.com/a/"), "example.com/a");
    assert.equal(shortenUrl("file:///Users/x/pelican-bike.html"), "pelican-bike.html");
    assert.equal(lastBrowserUrl(`await t.goto('https://a.dev'); await t.goto('https://b.dev')`), "https://b.dev");
  });

  it("finds the first code line", () => {
    assert.equal(firstCodeLine("\n// note\n  const x = 1;\n"), "const x = 1;");
  });
});

describe("parsePageSnapshot", () => {
  it("splits snapshot text into ref, role and name", () => {
    const snapshot = parsePageSnapshot({
      title: "Vela",
      url: "http://localhost:5173/",
      text: "[B6FF:6:1] h2 主对话\n[B6FF:6:2] separator 调整工作面板宽度\n\n[B6FF:6:3] button",
    });
    assert.equal(snapshot?.title, "Vela");
    assert.deepEqual(snapshot?.nodes, [
      { ref: "B6FF:6:1", role: "h2", name: "主对话" },
      { ref: "B6FF:6:2", role: "separator", name: "调整工作面板宽度" },
      { ref: "B6FF:6:3", role: "button", name: "" },
    ]);
  });

  it("keeps unrecognised lines and rejects other shapes", () => {
    assert.deepEqual(parsePageSnapshot({ text: "[r1] p hi\nstray" })?.extra, ["stray"]);
    assert.equal(parsePageSnapshot({ text: "no refs here" }), undefined);
    assert.equal(parsePageSnapshot(["[r1] p hi"]), undefined);
    assert.equal(parsePageSnapshot({ ok: true }), undefined);
  });
});
