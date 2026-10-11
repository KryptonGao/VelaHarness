import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { parseUiMessage, type InteractionMode, type UiPreference } from "@vela/shared";
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

  it("describes micro-apps only when the user turned them on", () => {
    const off = intelligentUiInstructions("auto", "agent") ?? "";
    assert.doesNotMatch(off, /```vela-app/);
    const on = intelligentUiInstructions("auto", "agent", { microApps: true }) ?? "";
    assert.match(on, /vela-app/);
    assert.match(on, /Sandboxed micro apps/);
    // 偏好为仅文字时，即使开关打开也不允许任何界面或微应用。
    const textOnly = intelligentUiInstructions("text_only", "agent", { microApps: true }) ?? "";
    assert.match(textOnly, /vela-app/);
    assert.match(textOnly, /Do not output/);
    assert.doesNotMatch(textOnly, /"op":"begin"/);
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
      assert.deepEqual(JSON.parse(readFileSync(join(dir, "intelligent-ui-settings.json"), "utf8")), { preference: "text_only", microApps: false });
    });
  });

  it("keeps micro-apps off by default and persists the switch without touching the preference", () => {
    withDir(dir => {
      const settings = new IntelligentUiSettings(dir);
      assert.equal(settings.microApps, false);
      settings.setPreference("visual_first");
      settings.setMicroApps(true);
      const restored = new IntelligentUiSettings(dir);
      assert.deepEqual(restored.state, { preference: "visual_first", microApps: true });
      restored.setMicroApps(false);
      assert.deepEqual(new IntelligentUiSettings(dir).state, { preference: "visual_first", microApps: false });
      assert.throws(() => settings.setMicroApps("yes" as unknown as boolean));
    });
  });

  it("only treats a literal true as enabling micro-apps", () => {
    withDir(dir => {
      for (const stored of ['{"microApps":"true"}', '{"microApps":1}', '{"microApps":null}', "[]"]) {
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
