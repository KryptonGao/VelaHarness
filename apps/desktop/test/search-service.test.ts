import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { SearchIndex, type SearchSource } from "../src/main/search-index.ts";
import { SearchWorkerCore, type SearchWorkerEvent } from "../src/main/search-service.ts";

const base = Date.parse("2026-05-01T00:00:00Z");
const filters = { includeArchived: true, includeTools: true };

let dir: string;
let index: SearchIndex;
let events: SearchWorkerEvent[];
let core: SearchWorkerCore;
let clock: number;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "vela-search-service-"));
  index = SearchIndex.open(join(dir, "index.sqlite"));
  events = [];
  clock = 0;
  core = new SearchWorkerCore(index, event => events.push(event), () => clock);
});
afterEach(() => { index.close(); rmSync(dir, { recursive: true, force: true }); });

function source(name: string, count: number, text = "needle"): SearchSource {
  const file = join(dir, `${name}.jsonl`);
  const lines = Array.from({ length: count }, (_, n) => `${JSON.stringify({
    type: "message", id: `${name}-${n}`, parentId: null, timestamp: new Date(base + n * 60_000).toISOString(),
    message: { role: "user", content: [{ type: "text", text: `${text} ${n}` }] },
  })}\n`);
  writeFileSync(file, lines.join(""));
  return { id: name, file, workspace: "", title: name, archived: false, updated: base };
}

function runUntilIdle(): void {
  while (core.tick());
}

const kinds = () => events.map(event => event.t === "hits" ? `hits:${event.hits.length}` : event.t);

describe("SearchWorkerCore", () => {
  it("posts hits after every slice, not once at the end", () => {
    core.handle({ t: "sync", sources: [source("c", 45)] });
    runUntilIdle();
    events.length = 0;
    core.handle({ t: "start", requestId: "r1", request: { query: "needle", filters } });
    assert.deepEqual(events, [], "starting a search does no work by itself");
    const batches: string[] = [];
    while (core.tick()) {
      batches.push(kinds().join(","));
      if (events.some(event => event.t === "done")) break;
    }
    const hits = events.filter(event => event.t === "hits");
    assert.deepEqual(hits.map(event => event.hits.length), [20, 20, 5]);
    // The first batch was out before the second slice ran.
    assert.equal(batches[0], "hits:20");
    assert.deepEqual(events.at(-1), { t: "done", requestId: "r1", next: null });
  });

  it("ends a page with the cursor of the next", () => {
    core.handle({ t: "sync", sources: [source("c", 80)] });
    runUntilIdle();
    events.length = 0;
    core.handle({ t: "start", requestId: "r1", request: { query: "needle", filters } });
    runUntilIdle();
    const done = events.find(event => event.t === "done");
    assert.equal(done?.t === "done" && typeof done.next, "number");
    assert.equal(events.filter(event => event.t === "hits").flatMap(event => event.hits).length, 50);
  });

  it("stops a search that was cancelled", () => {
    core.handle({ t: "sync", sources: [source("c", 80)] });
    runUntilIdle();
    events.length = 0;
    core.handle({ t: "start", requestId: "r1", request: { query: "needle", filters } });
    core.tick();
    assert.equal(events.filter(event => event.t === "hits").length, 1);
    core.handle({ t: "cancel", requestId: "r1" });
    runUntilIdle();
    assert.equal(events.filter(event => event.t === "hits").length, 1, "no hits after the cancel");
    assert.ok(!events.some(event => event.t === "done"));
  });

  it("answers an empty query with an empty page", () => {
    core.handle({ t: "start", requestId: "r1", request: { query: "  ", filters } });
    assert.deepEqual(events, [{ t: "done", requestId: "r1", next: null }]);
  });

  it("answers searches before indexing, and indexing resumes afterwards", () => {
    core.handle({ t: "sync", sources: [source("c", 3000, `${"filler ".repeat(40)}needle`)] });
    assert.equal(core.tick(), true);
    events.length = 0;
    core.handle({ t: "start", requestId: "r1", request: { query: "needle", filters } });
    core.tick();
    assert.ok(events.some(event => event.t === "hits"), "the search ran before the next indexing slice");
    runUntilIdle();
    const last = events.filter(event => event.t === "status").at(-1);
    assert.equal(last?.t === "status" && last.status.indexing, false);
  });

  it("reports indexing progress, at most every so often while it runs", () => {
    core.handle({ t: "sync", sources: [source("a", 3000, `${"filler ".repeat(40)}x`)] });
    assert.deepEqual(events.map(event => event.t), ["status"]);
    events.length = 0;
    clock = 10;
    core.tick();
    assert.deepEqual(events, [], "within the interval and still indexing: no status");
    clock = 1000;
    core.tick();
    assert.equal(events.at(-1)?.t, "status");
    runUntilIdle();
    const last = events.at(-1);
    assert.equal(last?.t === "status" && last.status.indexing, false);
  });

  it("reports a failed search for that request and keeps working", () => {
    index.close();
    core.handle({ t: "start", requestId: "r1", request: { query: "needle", filters } });
    assert.equal(events[0]?.t, "error");
    assert.equal(events[0]?.t === "error" && events[0].requestId, "r1");
    index = SearchIndex.open(join(dir, "index2.sqlite"));
  });
});
