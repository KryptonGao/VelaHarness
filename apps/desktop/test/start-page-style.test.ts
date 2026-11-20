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
mock.module("../src/renderer/ui-storage.ts", {
  namedExports: {
    uiStorage: {
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
    },
  },
});
mock.module("../src/renderer/logger.ts", {
  namedExports: {
    createLogger: () => ({ error: (...args: unknown[]) => failures.push(args) }),
  },
});

let revision = 0;
async function freshStyle() {
  const url = new URL("../src/renderer/hooks/useStartPageStyle.ts", import.meta.url);
  url.searchParams.set("test-revision", String(revision++));
  return await import(url.href) as typeof import("../src/renderer/hooks/useStartPageStyle.ts");
}

function reset() {
  mounted.splice(0).forEach(store => store.unsubscribe());
  values.clear();
  writes.length = 0;
  failures.length = 0;
  unreadable = false;
  unwritable = false;
}

const key = "vela.startPageStyle";
const legacyKey = "vela.minimalStart";

test("start page style defaults to atelier, respects legacy minimalStart, and rejects invalid values", async () => {
  reset();
  assert.deepEqual((await freshStyle()).startPageStyles, ["atelier", "deck", "classic", "minimal"]);
  for (const value of [undefined, "bad json", '"unknown"', "null", "true", "[]", "{}", '"Atelier"']) {
    if (value === undefined) values.delete(key);
    else values.set(key, value);
    assert.equal((await freshStyle()).useStartPageStyle(), "atelier", String(value));
  }
  assert.deepEqual(writes, [], "Loading defaults must not write to storage");

  values.delete(key);
  values.set(legacyKey, "true");
  assert.equal((await freshStyle()).useStartPageStyle(), "minimal", "Legacy minimalStart=true migrates to minimal");
});

test("start page style persists all four choices and mirrors legacy minimalStart", async () => {
  reset();
  const mod = await freshStyle();
  for (const choice of ["deck", "classic", "minimal", "atelier"] as const) {
    mod.setStartPageStyle(choice);
    assert.equal(values.get(key), JSON.stringify(choice));
    assert.equal(values.get(legacyKey), JSON.stringify(choice === "minimal"));
    assert.equal((await freshStyle()).useStartPageStyle(), choice);
  }
});

test("start page style updates subscribers and handles storage errors gracefully", async () => {
  reset();
  unreadable = true;
  const mod = await freshStyle();
  assert.equal(mod.useStartPageStyle(), "atelier");
  assert.equal(mod.useStartPageStyle(), "atelier");
  const [first, second] = mounted;

  unwritable = true;
  assert.doesNotThrow(() => mod.setStartPageStyle("deck"));
  assert.equal(first.getSnapshot(), "deck");
  assert.equal(second.getSnapshot(), "deck");
  assert.equal(first.notifications, 1);
  assert.equal(failures.length, 1);

  first.unsubscribe();
  unwritable = false;
  mod.setStartPageStyle("invalid" as Parameters<typeof mod.setStartPageStyle>[0]);
  assert.equal(first.notifications, 1);
  assert.equal(second.notifications, 2);
  assert.equal(second.getSnapshot(), "atelier");
  assert.equal(values.get(key), '"atelier"');
});

test("start page style setting is searchable on Interface and translated in all five locales", () => {
  const english = settingsCopy("en").appearance;
  for (const locale of ["zh-CN", "en", "zh-TW", "ja", "ko"] as const) {
    const copy = settingsCopy(locale);
    const entries = resolveSettingsEntries(copy);
    for (const query of ["起始页", "静纸", "指挥舱", "极简", "start page", "atelier", "command deck", "minimal"]) {
      const hit = searchSettings(query, entries).find(result => result.entry.id === "start-page-style");
      assert.ok(hit, `${locale}: ${query}`);
      assert.equal(hit.entry.page, "interface");
    }
    const text = copy.appearance;
    for (const field of [
      "startPageStyle",
      "startPageStyleHint",
      "startPageStyleAtelier",
      "startPageStyleAtelierHint",
      "startPageStyleDeck",
      "startPageStyleDeckHint",
      "startPageStyleClassicHint",
      "startPageStyleMinimal",
      "startPageStyleMinimalHint",
    ] as const) {
      assert.ok(text[field], `${locale}: ${field}`);
      if (locale !== "en") assert.notEqual(text[field], english[field], `${locale}: ${field}`);
    }
  }
});
