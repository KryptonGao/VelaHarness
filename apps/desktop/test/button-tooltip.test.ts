import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findTooltipButton, parseTooltip, tooltipSource, type TooltipElement } from "../src/renderer/button-tooltip.ts";

function element(attrs: Record<string, string> = {}, options: { classes?: string[]; text?: string; excluded?: boolean; button?: boolean } = {}): TooltipElement {
  const self: TooltipElement = {
    closest: (selector) => (selector.startsWith("button") ? (options.button === false ? null : self) : options.excluded ? self : null),
    getAttribute: (name) => attrs[name] ?? null,
    classList: { contains: (name) => (options.classes ?? []).includes(name) },
    textContent: options.text ?? "",
  };
  return self;
}

describe("button tooltip text", () => {
  it("splits a trailing shortcut from the label", () => {
    assert.deepEqual(parseTooltip("Browser (⇧⌘B)"), { label: "Browser", keys: ["⇧", "⌘", "B"] });
    assert.deepEqual(parseTooltip("New tab (⌘T)"), { label: "New tab", keys: ["⌘", "T"] });
    assert.deepEqual(parseTooltip("设置 (Ctrl+,)"), { label: "设置", keys: ["Ctrl", ","] });
    assert.deepEqual(parseTooltip("Toggle panel (Ctrl+Shift+J)"), { label: "Toggle panel", keys: ["Ctrl", "Shift", "J"] });
  });

  it("keeps ordinary parentheses in the label", () => {
    assert.deepEqual(parseTooltip("Model: GPT (preview)"), { label: "Model: GPT (preview)", keys: [] });
    assert.deepEqual(parseTooltip("Rename chat"), { label: "Rename chat", keys: [] });
  });
});

describe("button tooltip targets", () => {
  it("shows for ordinary buttons and ignores non-buttons", () => {
    const button = element({ title: "Rename chat" });
    assert.equal(findTooltipButton(button), button);
    assert.equal(findTooltipButton(element({}, { button: false })), null);
  });

  it("skips settings and tree/thinking areas", () => {
    assert.equal(findTooltipButton(element({ title: "x" }, { excluded: true })), null);
  });

  it("skips disclosure toggles but keeps menu triggers and header icon buttons", () => {
    assert.equal(findTooltipButton(element({ title: "x", "aria-expanded": "false" })), null);
    const menu = element({ title: "x", "aria-expanded": "false", "aria-haspopup": "menu" });
    assert.equal(findTooltipButton(menu), menu);
    const icon = element({ title: "x", "aria-expanded": "false" }, { classes: ["view-icon-btn"] });
    assert.equal(findTooltipButton(icon), icon);
  });

  it("only covers icon buttons without visible text", () => {
    assert.equal(tooltipSource(element({ title: "Title", "aria-label": "Label" })), "Title");
    assert.equal(tooltipSource(element({ "aria-label": "Label" })), "Label");
    assert.equal(tooltipSource(element({ title: "Model", "aria-label": "Model" }, { text: "GPT" })), null);
  });

  it("lets an icon button with a badge opt in", () => {
    assert.equal(tooltipSource(element({ title: "Inbox", "data-tooltip": "" }, { text: "9+" })), "Inbox");
  });
});
