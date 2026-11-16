import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { uiSandboxCsp } from "../src/intelligent-ui-sandbox.ts";
import {
  buildVisualSandboxDocument,
  parseVisualDemo,
  parseVisualSandboxMessage,
  visualDemoLimits,
} from "../src/visual-demo.ts";

describe("visual-demo", () => {
  it("validates and normalizes show_visual arguments", () => {
    assert.deepEqual(
      parseVisualDemo({ title: "  Approval   Banner  ", html: "<div>hi</div>", height: 300.6 }),
      { title: "Approval Banner", html: "<div>hi</div>", height: 301 },
    );
    assert.equal(parseVisualDemo(null), null);
    assert.equal(parseVisualDemo({ html: "   " }), null);
    assert.equal(parseVisualDemo({ html: 123 }), null);

    const clamped = parseVisualDemo({ html: "<svg></svg>", height: 9999 });
    assert.equal(clamped?.height, visualDemoLimits.maxHeight);
    const minClamped = parseVisualDemo({ html: "<svg></svg>", height: 5 });
    assert.equal(minClamped?.height, visualDemoLimits.minHeight);

    const oversized = "a".repeat(visualDemoLimits.maxHtmlBytes + 1);
    assert.equal(parseVisualDemo({ html: oversized }), null);
  });

  it("places CSP and bootstrap before model HTML and filters unsafe theme CSS values", () => {
    const doc = buildVisualSandboxDocument("<div id=\"demo\">ok</div>", {
      colorScheme: "dark",
      themeVars: {
        "--bg-card-surface": "#1e2028",
        "--text-primary": "#f0f2f5",
        "--bad-semicolon": "#fff; body{display:none}",
        "--bad-tag": "</style><script>alert(1)</script>",
        "not-a-var": "red",
      },
    });
    const cspIdx = doc.indexOf(uiSandboxCsp);
    const bootIdx = doc.indexOf("velaVisual");
    const htmlIdx = doc.indexOf('<div id="demo">ok</div>');
    assert.ok(cspIdx > 0 && bootIdx > cspIdx && htmlIdx > bootIdx);
    assert.ok(doc.includes("--bg-card-surface: #1e2028"));
    assert.ok(doc.includes("--text-primary: #f0f2f5"));
    assert.equal(doc.includes("--bad-semicolon"), false);
    assert.equal(doc.includes("--bad-tag"), false);
    assert.equal(doc.includes("not-a-var"), false);
    assert.ok(doc.includes("color-scheme: dark"));
  });

  it("parses and clamps sandbox postMessage payloads", () => {
    assert.deepEqual(parseVisualSandboxMessage({ velaVisual: 1, type: "ready" }), { type: "ready" });
    assert.deepEqual(parseVisualSandboxMessage({ velaVisual: 1, type: "resize", height: 1500 }), {
      type: "resize",
      height: visualDemoLimits.maxHeight,
    });
    assert.deepEqual(parseVisualSandboxMessage({ velaVisual: 1, type: "error", message: "boom" }), {
      type: "error",
      message: "boom",
    });
    assert.equal(parseVisualSandboxMessage({ vela: 1, type: "ready" }), null);
    assert.equal(parseVisualSandboxMessage({ velaVisual: 1, type: "resize", height: Number.NaN }), null);
    assert.equal(parseVisualSandboxMessage({ velaVisual: 1, type: "unknown" }), null);
  });
});
