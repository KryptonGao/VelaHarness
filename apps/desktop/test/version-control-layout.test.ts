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
async function freshLayout() {
  // A fresh module models reloading the renderer while retaining durable storage.
  const url = new URL("../src/renderer/hooks/useVersionControlLayout.ts", import.meta.url);
  url.searchParams.set("test-revision", String(revision++));
  return await import(url.href) as typeof import("../src/renderer/hooks/useVersionControlLayout.ts");
}

function reset() {
  mounted.splice(0).forEach(store => store.unsubscribe());
  values.clear();
  writes.length = 0;
  failures.length = 0;
  unreadable = false;
  unwritable = false;
}

const key = "vela.versionControlLayout";

test("version control layout defaults to classic and rejects invalid saved values", async () => {
  reset();
  assert.deepEqual((await freshLayout()).versionControlLayouts, ["classic", "review"]);
  for (const value of [undefined, "bad json", '"unknown"', "null", "true", "[]", '{}', '"Review"']) {
    if (value === undefined) values.delete(key);
    else values.set(key, value);
    assert.equal((await freshLayout()).useVersionControlLayout(), "classic", value);
  }
  assert.deepEqual(writes, [], "Reading a default must not replace durable preferences");
});

test("version control layout persists and restores either supported choice", async () => {
  reset();
  const layout = await freshLayout();
  layout.setVersionControlLayout("review");
  assert.deepEqual(writes, [[key, '"review"']]);
  assert.equal((await freshLayout()).useVersionControlLayout(), "review");
  layout.setVersionControlLayout("classic");
  assert.equal((await freshLayout()).useVersionControlLayout(), "classic");
  assert.equal(values.get(key), '"classic"');
});

test("all mounted layout subscribers update together and can unsubscribe", async () => {
  reset();
  const layout = await freshLayout();
  assert.equal(layout.useVersionControlLayout(), "classic");
  assert.equal(layout.useVersionControlLayout(), "classic");
  const [first, second] = mounted;
  layout.setVersionControlLayout("review");
  assert.equal(first.getSnapshot(), "review");
  assert.equal(second.getSnapshot(), "review");
  assert.equal(first.notifications, 1);
  assert.equal(second.notifications, 1);
  first.unsubscribe();
  layout.setVersionControlLayout("classic");
  assert.equal(first.notifications, 1);
  assert.equal(second.notifications, 2);
});

test("storage failures preserve a usable session and invalid runtime choices fall back", async () => {
  reset();
  unreadable = true;
  const layout = await freshLayout();
  assert.equal(layout.useVersionControlLayout(), "classic");
  unwritable = true;
  assert.doesNotThrow(() => layout.setVersionControlLayout("review"));
  assert.equal(mounted[0].getSnapshot(), "review");
  assert.equal(mounted[0].notifications, 1);
  assert.equal(failures.length, 1);
  unwritable = false;
  layout.setVersionControlLayout("invalid" as Parameters<typeof layout.setVersionControlLayout>[0]);
  assert.equal(mounted[0].getSnapshot(), "classic");
  assert.equal(values.get(key), '"classic"');
});

test("version control layout setting is searchable and localized in all five languages", () => {
  for (const locale of ["zh-CN", "en", "zh-TW", "ja", "ko"] as const) {
    const copy = settingsCopy(locale);
    const entries = resolveSettingsEntries(copy);
    for (const query of ["版本控制", "审查布局", "git", "version control", "file rail"]) {
      assert.ok(searchSettings(query, entries).some(result => result.entry.id === "version-control-layout"), `${locale}: ${query}`);
    }
    const text = copy.appearance;
    assert.ok(text.versionControlLayout);
    assert.ok(text.versionControlLayoutHint);
    assert.ok(text.versionControlLayoutClassic);
    assert.ok(text.versionControlLayoutReview);
    if (locale !== "en") {
      assert.notEqual(text.versionControlLayout, settingsCopy("en").appearance.versionControlLayout, locale);
      assert.notEqual(text.versionControlLayoutHint, settingsCopy("en").appearance.versionControlLayoutHint, locale);
      assert.notEqual(text.versionControlLayoutReview, settingsCopy("en").appearance.versionControlLayoutReview, locale);
    }
  }
});
