import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { ModelDirectory } from "../src/model-directory.ts";

const dirs: string[] = [];

async function open(): Promise<ModelDirectory> {
  const dir = await mkdtemp(join(tmpdir(), "vela-refresh-"));
  dirs.push(dir);
  return ModelDirectory.open(dir);
}

after(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("manual catalog refresh", () => {
  it("forces a network refresh past Pi's freshness window and reports provider failures", async () => {
    const saved = process.env.PI_OFFLINE;
    delete process.env.PI_OFFLINE;
    try {
      const directory = await open();
      const calls: unknown[] = [];
      let events = 0;
      directory.subscribeAuth((event) => {
        if (event.type === "catalog") events += 1;
      });
      directory.runtime.refresh = (async (options: unknown) => {
        calls.push(options);
        return { aborted: false, errors: new Map([["openai", new Error("HTTP 503")]]) };
      }) as typeof directory.runtime.refresh;

      const result = await directory.refreshCatalogNow();

      assert.deepEqual(calls, [{ allowNetwork: true, force: true }]);
      assert.equal(result.offline, false);
      assert.deepEqual(result.errors, [{ provider: "openai", message: "HTTP 503" }]);
      assert.equal(events, 1);
    } finally {
      if (saved === undefined) delete process.env.PI_OFFLINE;
      else process.env.PI_OFFLINE = saved;
    }
  });

  it("does not touch the network when PI_OFFLINE is set", async () => {
    const saved = process.env.PI_OFFLINE;
    process.env.PI_OFFLINE = "1";
    try {
      const directory = await open();
      directory.runtime.refresh = (async () => {
        throw new Error("must not refresh");
      }) as typeof directory.runtime.refresh;

      const result = await directory.refreshCatalogNow();

      assert.equal(result.offline, true);
      assert.deepEqual(result.errors, []);
    } finally {
      if (saved === undefined) delete process.env.PI_OFFLINE;
      else process.env.PI_OFFLINE = saved;
    }
  });
});
