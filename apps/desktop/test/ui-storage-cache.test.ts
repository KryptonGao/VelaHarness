import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCachedUiStorage, type UiStorageEntry } from "../src/preload/ui-storage-cache.ts";

function harness(initial: Record<string, string | null> = {}) {
  const calls = { load: 0, writes: [] as UiStorageEntry[][], syncWrites: [] as UiStorageEntry[][], errors: [] as string[] };
  let timer: (() => void) | undefined;
  let reject: Error | undefined;
  const storage = createCachedUiStorage({
    load: () => { calls.load += 1; return { ...initial }; },
    write: async entries => { calls.writes.push(entries); if (reject) throw reject; return []; },
    writeSync: entries => { calls.syncWrites.push(entries); },
    reportError: message => { calls.errors.push(message); },
  }, {
    setTimer: callback => { timer = callback; return 1; },
    clearTimer: () => { timer = undefined; },
  });
  return { storage, calls, fire: () => { const callback = timer; timer = undefined; callback?.(); }, failWith: (error: Error) => { reject = error; }, hasTimer: () => timer !== undefined };
}

describe("renderer UI storage cache", () => {
  it("loads the store once and serves every read from memory", () => {
    const { storage, calls } = harness({ "vela.a": "1" });
    for (let index = 0; index < 125; index += 1) storage.getItem("vela.a");
    assert.equal(storage.getItem("vela.a"), "1");
    assert.equal(storage.getItem("vela.missing"), undefined);
    assert.equal(calls.load, 1);
  });

  it("returns written values immediately and batches the IPC write", async () => {
    const { storage, calls, fire, hasTimer } = harness();
    storage.setItem("vela.a", "1");
    storage.setItem("vela.b", "2");
    storage.setItem("vela.a", "3");
    storage.removeItem("vela.b");
    assert.equal(storage.getItem("vela.a"), "3");
    assert.equal(storage.getItem("vela.b"), null);
    assert.equal(calls.writes.length, 0);
    assert.equal(hasTimer(), true);
    fire();
    assert.deepEqual(calls.writes, [[["vela.a", "3"], ["vela.b", null]]]);
    assert.equal(hasTimer(), false);
  });

  it("skips writes that do not change the stored value", () => {
    const { storage, calls, hasTimer } = harness({ "vela.a": "1" });
    storage.setItem("vela.a", "1");
    assert.equal(hasTimer(), false);
    storage.flush();
    assert.equal(calls.writes.length, 0);
  });

  it("flushes pending entries synchronously on unload", () => {
    const { storage, calls, hasTimer } = harness();
    storage.setItem("vela.a", "1");
    storage.flushSync();
    assert.deepEqual(calls.syncWrites, [[["vela.a", "1"]]]);
    assert.equal(hasTimer(), false);
    storage.flushSync();
    assert.equal(calls.syncWrites.length, 1);
  });

  it("rejects invalid keys synchronously and reports failed writes", async () => {
    const { storage, calls, failWith, fire } = harness();
    assert.throws(() => storage.setItem("other", "x"));
    assert.throws(() => storage.setItem("vela." + "k".repeat(200), "x"));
    failWith(new Error("ipc down"));
    storage.setItem("vela.a", "1");
    fire();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls.errors, ["UI storage write failed"]);
    assert.equal(storage.getItem("vela.a"), "1");
  });
});

describe("renderer UI storage cache ordering", () => {
  it("sends keys the main process acts on at once and validates before caching", () => {
    const writes: UiStorageEntry[][] = [];
    const storage = createCachedUiStorage({
      load: () => ({}),
      write: async entries => { writes.push(entries); return []; },
      writeSync: () => {},
      reportError: () => {},
    }, {
      immediate: key => key === "vela.now",
      validate: (key, value) => { if (key === "vela.checked" && value === "bad") throw new Error("Invalid"); },
      setTimer: () => 1,
      clearTimer: () => {},
    });
    storage.setItem("vela.later", "1");
    storage.setItem("vela.now", "2");
    assert.deepEqual(writes, [[["vela.later", "1"], ["vela.now", "2"]]]);
    assert.throws(() => storage.setItem("vela.checked", "bad"), /Invalid/);
    assert.equal(storage.getItem("vela.checked"), undefined);
  });
});
