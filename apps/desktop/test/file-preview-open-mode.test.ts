import assert from "node:assert/strict";
import { mock, test } from "node:test";
import * as React from "react";
import { settingsCopy } from "../src/renderer/components/settings-copy.ts";
import { resolveSettingsEntries, searchSettings } from "../src/renderer/components/settings/settings-search.ts";

type MountedStore = { getSnapshot(): unknown; notifications: number; unsubscribe(): void };
const mounted: MountedStore[] = [];
const values = new Map<string, string>();
const writes: [string, string][] = [];
const failures: unknown[] = [];
let unreadable = false;
let unwritable = false;

mock.module("react", {
  defaultExport: React.default,
  namedExports: {
    ...Object.fromEntries(Object.entries(React).filter(([name]) => name !== "default")),
    useSyncExternalStore(subscribe: (listener: () => void) => () => void, getSnapshot: () => unknown) {
      const store: MountedStore = { getSnapshot, notifications: 0, unsubscribe: () => {} };
      store.unsubscribe = subscribe(() => store.notifications++);
      mounted.push(store);
      return getSnapshot();
    },
  },
});
mock.module("../src/renderer/ui-storage.ts", { namedExports: { uiStorage: {
  getItem(key: string) {
    if (unreadable) throw new Error("read unavailable");
    return values.get(key) ?? null;
  },
  setItem(key: string, value: string) {
    if (unwritable) throw new Error("write unavailable");
    values.set(key, value);
    writes.push([key, value]);
  },
  removeItem(key: string) { values.delete(key); },
} } });
mock.module("../src/renderer/logger.ts", { namedExports: {
  createLogger: () => ({ error: (...args: unknown[]) => failures.push(args) }),
} });

let revision = 0;
async function freshMode() {
  // Recreate the renderer module while retaining durable storage.
  const url = new URL("../src/renderer/hooks/useFilePreviewOpenMode.ts", import.meta.url);
  url.searchParams.set("test-revision", String(revision++));
  return await import(url.href) as typeof import("../src/renderer/hooks/useFilePreviewOpenMode.ts");
}

function reset() {
  mounted.splice(0).forEach(store => store.unsubscribe());
  values.clear();
  writes.length = 0;
  failures.length = 0;
  unreadable = false;
  unwritable = false;
}

const key = "vela.filePreviewOpenMode";

test("file preview opening defaults to new-tab and rejects invalid saved values", async () => {
  reset();
  assert.deepEqual((await freshMode()).filePreviewOpenModes, ["new-tab", "current-tab"]);
  for (const value of [undefined, "bad json", '"unknown"', "null", "true", "[]", '{}', '"Current-tab"']) {
    if (value === undefined) values.delete(key);
    else values.set(key, value);
    assert.equal((await freshMode()).useFilePreviewOpenMode(), "new-tab", value);
  }
  assert.deepEqual(writes, [], "Loading a default must not replace durable preferences");
});

test("file preview opening persists and restores both supported choices", async () => {
  reset();
  const mode = await freshMode();
  mode.setFilePreviewOpenMode("current-tab");
  assert.deepEqual(writes, [[key, '"current-tab"']]);
  assert.equal((await freshMode()).useFilePreviewOpenMode(), "current-tab");
  mode.setFilePreviewOpenMode("new-tab");
  assert.equal((await freshMode()).useFilePreviewOpenMode(), "new-tab");
  assert.equal(values.get(key), '"new-tab"');
});

test("file preview opening subscribers update together and can unsubscribe", async () => {
  reset();
  const mode = await freshMode();
  assert.equal(mode.useFilePreviewOpenMode(), "new-tab");
  assert.equal(mode.useFilePreviewOpenMode(), "new-tab");
  const [first, second] = mounted;
  mode.setFilePreviewOpenMode("current-tab");
  assert.equal(first.getSnapshot(), "current-tab");
  assert.equal(second.getSnapshot(), "current-tab");
  assert.equal(first.notifications, 1);
  assert.equal(second.notifications, 1);
  first.unsubscribe();
  mode.setFilePreviewOpenMode("new-tab");
  assert.equal(first.notifications, 1);
  assert.equal(second.notifications, 2);
});

test("file preview opening remains usable when storage fails and rejects invalid runtime choices", async () => {
  reset();
  unreadable = true;
  const mode = await freshMode();
  assert.equal(mode.useFilePreviewOpenMode(), "new-tab");
  unwritable = true;
  assert.doesNotThrow(() => mode.setFilePreviewOpenMode("current-tab"));
  assert.equal(mounted[0].getSnapshot(), "current-tab");
  assert.equal(mounted[0].notifications, 1);
  assert.equal(failures.length, 1);
  unwritable = false;
  mode.setFilePreviewOpenMode("invalid" as Parameters<typeof mode.setFilePreviewOpenMode>[0]);
  assert.equal(mounted[0].getSnapshot(), "new-tab");
  assert.equal(values.get(key), '"new-tab"');
});

test("file opening setting is searchable on Interface and localized in all five languages", () => {
  const english = settingsCopy("en").appearance;
  for (const locale of ["zh-CN", "en", "zh-TW", "ja", "ko"] as const) {
    const copy = settingsCopy(locale);
    const entries = resolveSettingsEntries(copy);
    for (const query of ["文件打开方式", "文件预览", "新标签页", "当前标签页", "file opening", "file preview", "new tab", "current tab", "reuse"]) {
      const result = searchSettings(query, entries).find(result => result.entry.id === "file-preview-open-mode");
      assert.ok(result, `${locale}: ${query}`);
      assert.equal(result.entry.page, "interface");
    }
    const text = copy.appearance;
    for (const field of ["filePreviewOpenMode", "filePreviewOpenModeHint", "filePreviewOpenModeNewTab", "filePreviewOpenModeCurrentTab"] as const) {
      assert.ok(text[field], `${locale}: ${field}`);
      if (locale !== "en") assert.notEqual(text[field], english[field], `${locale}: ${field}`);
    }
    assert.ok(searchSettings(text.filePreviewOpenMode, entries).some(result => result.entry.id === "file-preview-open-mode"), locale);
  }
});
