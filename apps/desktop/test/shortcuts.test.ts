import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MENU_ACTIONS } from "@vela/shared";
import {
  acceleratorMap, actionForEvent, bindingFromEvent, defaultBindings, findConflict, formatBinding, isCustomized,
  isReservedBinding, isUsableBinding, normalizeBinding, parseOverrides, resolveBindings, shortcutActions,
  shortcutDefinitions, toAccelerator,
} from "../src/renderer/shortcuts.ts";

const key = (code: string, mods: { meta?: boolean; ctrl?: boolean; alt?: boolean; shift?: boolean } = {}) =>
  ({ code, metaKey: !!mods.meta, ctrlKey: !!mods.ctrl, altKey: !!mods.alt, shiftKey: !!mods.shift });

describe("shortcut bindings", () => {
  it("reads physical keys so Option-modified characters still match", () => {
    // ⌥⌘S 在 macOS 上 event.key 是 ß,按 code 仍应得到 Mod+Alt+S
    assert.equal(bindingFromEvent(key("KeyS", { meta: true, alt: true }), "darwin"), "Mod+Alt+S");
    assert.equal(bindingFromEvent(key("BracketRight", { meta: true, shift: true }), "darwin"), "Mod+Shift+]");
    assert.equal(bindingFromEvent(key("Tab", { ctrl: true }), "darwin"), "Ctrl+Tab");
  });

  it("treats Ctrl as Mod off macOS and rejects the Windows key", () => {
    assert.equal(bindingFromEvent(key("KeyN", { ctrl: true }), "win32"), "Mod+N");
    assert.equal(bindingFromEvent(key("KeyN", { meta: true }), "win32"), null);
  });

  it("ignores modifier-only presses", () => {
    assert.equal(bindingFromEvent(key("MetaLeft", { meta: true }), "darwin"), null);
    assert.equal(bindingFromEvent(key("ShiftLeft", { shift: true }), "darwin"), null);
  });

  it("normalizes modifier order and rejects malformed strings", () => {
    assert.equal(normalizeBinding("Shift+Mod+]"), "Mod+Shift+]");
    assert.equal(normalizeBinding("Mod+Mod+N"), null);
    assert.equal(normalizeBinding("Hyper+N"), null);
    assert.equal(normalizeBinding("Mod+Nope"), null);
  });

  it("requires a real modifier except for function keys", () => {
    assert.equal(isUsableBinding("N"), false);
    assert.equal(isUsableBinding("Shift+N"), false);
    assert.equal(isUsableBinding("Alt+N"), true);
    assert.equal(isUsableBinding("F5"), true);
    assert.equal(isReservedBinding("Mod+C"), true);
    assert.equal(isReservedBinding("Mod+N"), false);
  });

  it("formats for each platform", () => {
    assert.equal(formatBinding("Mod+Shift+]", "darwin"), "⇧⌘]");
    assert.equal(formatBinding("Mod+Alt+S", "darwin"), "⌥⌘S");
    assert.equal(formatBinding("Ctrl+Shift+G", "darwin"), "⌃⇧G");
    assert.equal(formatBinding("Alt+Left", "win32"), "Alt+←");
    assert.equal(formatBinding("Mod+Shift+]", "win32"), "Ctrl+Shift+]");
  });

  it("builds Electron accelerators and skips text-editing combos", () => {
    assert.equal(toAccelerator("Mod+Shift+]", "darwin"), "CmdOrCtrl+Shift+]");
    assert.equal(toAccelerator("Ctrl+Shift+G", "darwin"), "Ctrl+Shift+G");
    assert.equal(toAccelerator("Mod+Shift+]", "linux"), "Ctrl+Shift+]");
    assert.equal(toAccelerator("Alt+Left", "linux"), null);
  });
});

describe("shortcut resolution", () => {
  it("has a definition for every action and each is a menu action", () => {
    assert.equal(new Set(shortcutActions).size, shortcutDefinitions.length);
    for (const action of shortcutActions) assert.ok((MENU_ACTIONS as readonly string[]).includes(action), action);
  });

  it("ships defaults that are valid and conflict-free on every platform", () => {
    for (const platform of ["darwin", "win32", "linux"]) {
      const bindings = resolveBindings({}, platform);
      const seen = new Map<string, string>();
      for (const action of shortcutActions) {
        for (const binding of bindings[action]) {
          assert.equal(normalizeBinding(binding), binding, `${action} ${binding}`);
          assert.ok(isUsableBinding(binding), `${action} ${binding}`);
          assert.equal(seen.get(binding), undefined, `${binding} used by ${seen.get(binding)} and ${action} on ${platform}`);
          seen.set(binding, action);
        }
      }
    }
  });

  it("keeps the historical defaults", () => {
    assert.deepEqual(defaultBindings("go-back", "darwin"), ["Mod+["]);
    assert.deepEqual(defaultBindings("go-back", "win32"), ["Alt+Left"]);
    assert.deepEqual(defaultBindings("toggle-sidebar", "darwin"), ["Mod+B"]);
    assert.deepEqual(defaultBindings("new-tab", "linux"), ["Mod+T"]);
  });

  it("lets overrides replace defaults, including clearing them", () => {
    const bindings = resolveBindings({ "new-chat": ["Mod+Alt+N"], "toggle-info": [] }, "darwin");
    assert.deepEqual(bindings["new-chat"], ["Mod+Alt+N"]);
    assert.deepEqual(bindings["toggle-info"], []);
    assert.deepEqual(bindings["toggle-sidebar"], ["Mod+B"]);
    assert.equal(isCustomized("new-chat", { "new-chat": ["Mod+Alt+N"] }, "darwin"), true);
    assert.equal(isCustomized("new-chat", { "new-chat": ["Mod+N"] }, "darwin"), false);
  });

  it("reports which action already owns a binding", () => {
    const bindings = resolveBindings({}, "darwin");
    assert.equal(findConflict("Mod+B", "new-chat", bindings), "toggle-sidebar");
    assert.equal(findConflict("Mod+B", "toggle-sidebar", bindings), null);
    assert.equal(findConflict("Mod+Alt+Q", "new-chat", bindings), null);
  });

  it("dispatches events to actions and honours custom bindings", () => {
    const defaults = resolveBindings({}, "darwin");
    assert.equal(actionForEvent(key("KeyN", { meta: true }), defaults, "darwin", false), "new-chat");
    assert.equal(actionForEvent(key("KeyS", { meta: true, alt: true }), defaults, "darwin", true), "side-chat");
    assert.equal(actionForEvent(key("Tab", { ctrl: true, shift: true }), defaults, "darwin", false), "prev-tab");
    assert.equal(actionForEvent(key("KeyZ", { meta: true }), defaults, "darwin", false), null);
    const custom = resolveBindings({ "new-chat": ["Mod+Alt+N"] }, "darwin");
    assert.equal(actionForEvent(key("KeyN", { meta: true }), custom, "darwin", false), null);
    assert.equal(actionForEvent(key("KeyN", { meta: true, alt: true }), custom, "darwin", false), "new-chat");
  });

  it("leaves Alt+Arrow to text fields on Windows/Linux", () => {
    const bindings = resolveBindings({}, "linux");
    assert.equal(actionForEvent(key("ArrowLeft", { alt: true }), bindings, "linux", false), "go-back");
    assert.equal(actionForEvent(key("ArrowLeft", { alt: true }), bindings, "linux", true), null);
  });

  it("sends the first registrable accelerator per action", () => {
    const map = acceleratorMap(resolveBindings({}, "darwin"), "darwin");
    assert.equal(map["next-tab"], "CmdOrCtrl+Shift+]");
    assert.equal(map["go-back"], "CmdOrCtrl+[");
    assert.equal(map["open-terminal"], undefined);
    assert.equal(acceleratorMap(resolveBindings({}, "linux"), "linux")["go-back"], undefined);
  });

  it("drops unrecognised saved values without losing the rest", () => {
    assert.deepEqual(
      parseOverrides({ "new-chat": ["Shift+Mod+K", "bogus", "N", 5], "nope": ["Mod+Q"], "toggle-info": "Mod+J", "new-tab": [] }),
      { "new-chat": ["Mod+Shift+K"], "new-tab": [] },
    );
    assert.deepEqual(parseOverrides(null), {});
    assert.deepEqual(parseOverrides([]), {});
  });
});
