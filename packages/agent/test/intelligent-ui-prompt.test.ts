import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { parseUiMessage, uiAppIconNames, type InteractionMode, type UiPreference } from "@vela/shared";
import { IntelligentUiSettings } from "../src/intelligent-ui-settings.ts";
import { intelligentUiExample, intelligentUiInstructions } from "../src/intelligent-ui-prompt.ts";
import { fenced } from "./fixtures/intelligent-ui.ts";

describe("intelligentUiInstructions", () => {
  it("injects the syntax only in agent mode", () => {
    const others: InteractionMode[] = ["plan", "goal"];
    for (const mode of others) {
      for (const preference of ["auto", "text_only", "visual_first"] as UiPreference[]) {
        assert.equal(intelligentUiInstructions(preference, mode), null, `${preference}/${mode}`);
      }
    }
    assert.match(intelligentUiInstructions("auto", "agent") ?? "", /vela-ui/);
  });

  it("tells the model to stay with text when the user turned it off", () => {
    const text = intelligentUiInstructions("text_only", "agent") ?? "";
    assert.match(text, /Do not output vela-ui/);
    assert.doesNotMatch(text, /"op":"begin"/);
  });

  it("differs between auto and visual_first but keeps the same syntax", () => {
    const auto = intelligentUiInstructions("auto", "agent");
    const visual = intelligentUiInstructions("visual_first", "agent");
    assert.notEqual(auto, visual);
    assert.ok(auto?.includes("### Format") && visual?.includes("### Format"));
  });

  it("describes automatic launch by default and omits micro-app syntax when disabled", () => {
    const off = intelligentUiInstructions("auto", "agent", { microApps: false }) ?? "";
    assert.doesNotMatch(off, /```vela-app/);
    const on = intelligentUiInstructions("auto", "agent") ?? "";
    assert.match(on, /starts automatically/);
    assert.match(on, /vela-app/);
    assert.match(on, /Sandboxed micro apps/);
    // 偏好为仅文字时，即使开关打开也不允许任何界面或微应用。
    const textOnly = intelligentUiInstructions("text_only", "agent", { microApps: true }) ?? "";
    assert.match(textOnly, /vela-app/);
    assert.match(textOnly, /Do not output/);
    assert.doesNotMatch(textOnly, /"op":"begin"/);
  });

  it("documents only the shared built-in icon names and shows a valid micro-app header", () => {
    const text = intelligentUiInstructions("auto", "agent") ?? "";
    assert.ok(text.includes(`The optional icon field accepts only these built-in names: ${uiAppIconNames.join(", ")}.`));
    assert.match(text, /Omit it for the default micro-app icon\. Never use URLs, HTML, SVG markup, or emoji/);
    const header = text.match(/\{"op":"app",[^\n}]+\}/)?.[0];
    assert.ok(header);
    const [segment] = parseUiMessage(`\`\`\`vela-app\n${header.replace("<unique id>", "chart-demo")}\n<p>Chart</p>\n\`\`\``);
    assert.ok(segment?.type === "app");
    assert.equal(segment.app.status, "ready");
    assert.equal(segment.app.icon, "chart-bar");
  });

  it("ships an example that the real parser accepts as a ready artifact", () => {
    const segments = parseUiMessage(fenced(intelligentUiExample.split("\n")), { now: () => 0 });
    const ui = segments.find(segment => segment.type === "ui");
    assert.ok(ui && ui.type === "ui");
    assert.equal(ui.artifact.status, "ready");
    assert.equal(ui.artifact.nodes.filter(node => node.invalid).length, 0);
  });
});

describe("IntelligentUiSettings", () => {
  const withDir = (run: (dir: string) => void) => {
    const dir = mkdtempSync(join(tmpdir(), "vela-iui-"));
    try { run(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
  };

  it("defaults to auto and persists changes", () => {
    withDir(dir => {
      const settings = new IntelligentUiSettings(dir);
      assert.equal(settings.preference, "auto");
      settings.setPreference("text_only");
      assert.equal(new IntelligentUiSettings(dir).preference, "text_only");
      assert.deepEqual(JSON.parse(readFileSync(join(dir, "intelligent-ui-settings.json"), "utf8")), { preference: "text_only", microApps: true });
    });
  });

  it("enables micro-apps by default and persists both switch positions without touching the preference", () => {
    withDir(dir => {
      const settings = new IntelligentUiSettings(dir);
      assert.equal(settings.microApps, true);
      settings.setPreference("visual_first");
      settings.setMicroApps(false);
      const restored = new IntelligentUiSettings(dir);
      assert.deepEqual(restored.state, { preference: "visual_first", microApps: false });
      restored.setMicroApps(true);
      assert.deepEqual(new IntelligentUiSettings(dir).state, { preference: "visual_first", microApps: true });
      assert.throws(() => settings.setMicroApps("yes" as unknown as boolean));
    });
  });

  it("uses the default for legacy profiles without a switch", () => {
    withDir(dir => {
      writeFileSync(join(dir, "intelligent-ui-settings.json"), '{"preference":"visual_first"}');
      assert.deepEqual(new IntelligentUiSettings(dir).state, { preference: "visual_first", microApps: true });
    });
  });

  it("does not run micro-apps when saved settings are malformed", () => {
    withDir(dir => {
      for (const stored of ['{"microApps":"true"}', '{"microApps":1}', '{"microApps":null}', "[]", "not json"]) {
        writeFileSync(join(dir, "intelligent-ui-settings.json"), stored);
        assert.equal(new IntelligentUiSettings(dir).microApps, false, stored);
      }
    });
  });

  it("falls back to auto for corrupt or unknown stored values", () => {
    withDir(dir => {
      writeFileSync(join(dir, "intelligent-ui-settings.json"), '{"preference":"always_ui"}');
      assert.equal(new IntelligentUiSettings(dir).preference, "auto");
      writeFileSync(join(dir, "intelligent-ui-settings.json"), "not json");
      assert.equal(new IntelligentUiSettings(dir).preference, "auto");
    });
  });

  it("rejects invalid preferences without changing the stored one", () => {
    withDir(dir => {
      const settings = new IntelligentUiSettings(dir);
      settings.setPreference("visual_first");
      assert.throws(() => settings.setPreference("bogus" as UiPreference));
      assert.equal(settings.preference, "visual_first");
      assert.equal(new IntelligentUiSettings(dir).preference, "visual_first");
    });
  });
});
