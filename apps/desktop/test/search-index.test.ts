import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { DatabaseSync } from "node:sqlite";
import type { ConversationSearchFilters, ConversationSearchHit } from "@vela/shared";
import { SearchIndex, buildSnippet, type SearchSource } from "../src/main/search-index.ts";

const day = 86_400_000;
const base = Date.parse("2026-05-01T00:00:00Z");
const all: ConversationSearchFilters = { includeArchived: true, includeTools: true };

let dir: string;
let index: SearchIndex;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "vela-search-")); index = SearchIndex.open(join(dir, "index.sqlite")); });
afterEach(() => { index.close(); rmSync(dir, { recursive: true, force: true }); });

const message = (id: string, at: number, body: unknown) => `${JSON.stringify({ type: "message", id, parentId: null, timestamp: new Date(at).toISOString(), message: body })}\n`;
const user = (id: string, at: number, text: string) => message(id, at, { role: "user", content: [{ type: "text", text }] });
const reply = (id: string, at: number, text: string) => message(id, at, { role: "assistant", content: [{ type: "text", text }] });
const call = (id: string, at: number, callId: string, command: string) => message(id, at, { role: "assistant", content: [{ type: "toolCall", id: callId, name: "bash", arguments: { command } }] });
const output = (id: string, at: number, callId: string, text: string, toolName = "bash") => message(id, at, { role: "toolResult", toolCallId: callId, toolName, content: [{ type: "text", text }] });

function chat(name: string, lines: string[], extra: Partial<SearchSource> = {}): SearchSource {
  const file = join(dir, `${name}.jsonl`);
  writeFileSync(file, lines.join(""));
  return { id: name, file, workspace: "/work/app", title: name, archived: false, updated: base, ...extra };
}

function drain(target = index): void {
  while (target.indexSlice());
}

/** Every hit of a search, across pages, plus how many steps it took. */
function search(query: string, filters: Partial<ConversationSearchFilters> = {}, after?: number): { hits: ConversationSearchHit[]; next: number | null; steps: number } {
  const run = index.search({ query, filters: { ...all, ...filters }, ...(after !== undefined ? { after } : {}) });
  assert.ok(run, `query "${query}" has keywords`);
  const hits: ConversationSearchHit[] = [];
  let steps = 0;
  for (;;) {
    const step = run.step();
    steps += 1;
    hits.push(...step.hits);
    if (step.done) return { hits, next: step.next, steps };
  }
}

const ids = (hits: ConversationSearchHit[]) => hits.map(hit => `${hit.conversationId}:${hit.entryId}`);

describe("SearchIndex", () => {
  it("finds messages and lists the newest first, across chats", () => {
    index.setSources([
      chat("old", [user("u1", base, "the deploy failed"), reply("a1", base + 1000, "check the deploy log")]),
      chat("new", [user("u2", base + 5 * day, "deploy again please")]),
    ]);
    drain();
    assert.deepEqual(ids(search("deploy").hits), ["new:u2", "old:a1", "old:u1"]);
  });

  it("matches any substring of three or more characters in any language, ignoring case", () => {
    index.setSources([chat("c", [user("u1", base, "终端里报错：Cannot find module 'Zod'"), reply("a1", base + 1, "NPM ERR! code ENOENT")])]);
    drain();
    assert.deepEqual(ids(search("报错：").hits), ["c:u1"]);
    assert.deepEqual(ids(search("find MODULE").hits), ["c:u1"]);
    assert.deepEqual(ids(search("npm err").hits), ["c:a1"]);
    assert.deepEqual(ids(search("enoe").hits), ["c:a1"]);
    assert.deepEqual(search("没有这段").hits, []);
  });

  it("matches keywords shorter than three characters by scanning", () => {
    index.setSources([chat("c", [user("u1", base, "发生了报错"), user("u2", base + day, "everything fine"), reply("a1", base + 2 * day, "a1 ok")])]);
    drain();
    assert.deepEqual(ids(search("报错").hits), ["c:u1"]);
    assert.deepEqual(ids(search("a1").hits), ["c:a1"]);
    // A short keyword together with a longer one narrows the longer one's matches.
    assert.deepEqual(ids(search("ok a1").hits), ["c:a1"]);
    assert.deepEqual(ids(search("fine zz").hits), []);
    // LIKE wildcards in the query are text.
    assert.deepEqual(search("%").hits, []);
    assert.deepEqual(search("_").hits, []);
  });

  it("requires every keyword, and treats quoted text as one keyword", () => {
    index.setSources([chat("c", [user("u1", base, "ERR from npm"), user("u2", base + 1, "npm ERR! failed"), user("u3", base + 2, "only npm here")])]);
    drain();
    assert.deepEqual(ids(search("npm ERR").hits).sort(), ["c:u1", "c:u2"]);
    assert.deepEqual(ids(search('"npm ERR"').hits), ["c:u2"]);
    assert.deepEqual(ids(search('npm "ERR!" failed').hits), ["c:u2"]);
  });

  it("finds tool calls and tool output and reports the call they belong to", () => {
    index.setSources([chat("c", [
      user("u1", base, "run it"),
      call("a1", base + 1000, "call-1", "git push origin main"),
      output("r1", base + 2000, "call-1", "error: failed to push some refs"),
    ])]);
    drain();
    const push = search("git push").hits;
    assert.deepEqual(push.map(hit => [hit.entryId, hit.kind, hit.toolCallId]), [["a1", "tool", "call-1"]]);
    const failed = search("failed to push").hits;
    assert.deepEqual(failed.map(hit => [hit.entryId, hit.kind, hit.toolCallId]), [["r1", "tool", "call-1"]]);
    assert.deepEqual(search("failed to push", { includeTools: false }).hits, []);
  });

  it("does not index MCP output and clips a file read to its start", () => {
    index.setSources([chat("c", [
      output("r1", base, "c1", "mcp secret value", "mcp__notion__fetch"),
      output("r2", base + 1, "c2", `${"x".repeat(2500)}tail-marker`, "read"),
      output("r3", base + 2, "c3", `${"x".repeat(2500)}tail-marker`, "bash"),
    ])]);
    drain();
    assert.deepEqual(search("secret value").hits, []);
    assert.deepEqual(ids(search("tail-marker").hits), ["c:r3"]);
  });

  it("filters by project, date, archive state and tool output", () => {
    index.setSources([
      chat("a", [user("u1", base, "needle one")], { workspace: "/work/app" }),
      chat("b", [user("u2", base + 10 * day, "needle two")], { workspace: "/work/lib" }),
      chat("c", [user("u3", base + 20 * day, "needle three"), output("r1", base + 20 * day + 1, "x", "needle output")], { workspace: "", archived: true }),
    ]);
    drain();
    assert.deepEqual(ids(search("needle").hits), ["c:r1", "c:u3", "b:u2", "a:u1"]);
    assert.deepEqual(ids(search("needle", { workspace: "/work/lib" }).hits), ["b:u2"]);
    assert.deepEqual(ids(search("needle", { workspace: "" }).hits), ["c:r1", "c:u3"]);
    assert.deepEqual(ids(search("needle", { includeArchived: false }).hits), ["b:u2", "a:u1"]);
    assert.deepEqual(ids(search("needle", { includeTools: false }).hits), ["c:u3", "b:u2", "a:u1"]);
    assert.deepEqual(ids(search("needle", { from: base + 5 * day, to: base + 15 * day }).hits), ["b:u2"]);
    assert.deepEqual(ids(search("needle", { from: base + 10 * day }).hits), ["c:r1", "c:u3", "b:u2"]);
    assert.deepEqual(ids(search("needle", { to: base + 10 * day }).hits), ["a:u1"]);
  });

  it("returns results a page at a time and continues from the cursor without repeats", () => {
    const lines = Array.from({ length: 120 }, (_, n) => user(`u${n}`, base + n * 60_000, `match number ${n}`));
    index.setSources([chat("c", lines)]);
    drain();
    const first = search("match number");
    assert.equal(first.hits.length, 50);
    assert.equal(first.hits[0]!.entryId, "u119");
    assert.ok(first.next !== null);
    const second = search("match number", {}, first.next!);
    assert.equal(second.hits.length, 50);
    assert.equal(second.hits[0]!.entryId, "u69");
    const third = search("match number", {}, second.next!);
    assert.equal(third.hits.length, 20);
    assert.equal(third.next, null);
    assert.equal(new Set([...first.hits, ...second.hits, ...third.hits].map(hit => hit.cursor)).size, 120);
  });

  it("produces hits before the search finishes", () => {
    const early = Array.from({ length: 30 }, (_, n) => user(`e${n}`, base + n, "needle early"));
    const late = Array.from({ length: 30 }, (_, n) => user(`l${n}`, base + 40 * day + n, "needle late"));
    index.setSources([chat("c", [...early, ...late])]);
    drain();
    const run = index.search({ query: "needle", filters: all })!;
    const first = run.step();
    assert.ok(first.hits.length > 0, "the first slice already has hits");
    assert.equal(first.done, false);
    assert.ok(first.hits.every(hit => hit.entryId.startsWith("l")), "the newest messages come first");
  });

  it("only reads what a chat file gained since the last pass", () => {
    const source = chat("c", [user("u1", base, "first needle")]);
    index.setSources([source]);
    drain();
    assert.deepEqual(ids(search("needle").hits), ["c:u1"]);
    appendFileSync(source.file, user("u2", base + day, "second needle"));
    // A record still being written is left until its line is complete.
    const partial = user("u3", base + 2 * day, "third needle");
    appendFileSync(source.file, partial.slice(0, 40));
    index.setSources([source]);
    assert.equal(index.status().total, 1);
    drain();
    assert.deepEqual(ids(search("needle").hits), ["c:u2", "c:u1"]);
    appendFileSync(source.file, partial.slice(40));
    index.setSources([source]);
    drain();
    assert.deepEqual(ids(search("needle").hits), ["c:u3", "c:u2", "c:u1"]);
  });

  it("does not read a chat that did not change", () => {
    const source = chat("c", [user("u1", base, "needle")]);
    index.setSources([source]);
    drain();
    index.setSources([source]);
    assert.deepEqual(index.status(), { indexing: false, indexed: 0, total: 0 });
  });

  it("starts a chat over when its file was rewritten", () => {
    const source = chat("c", [user("u1", base, "original needle text"), user("u2", base + 1, "another original line")]);
    index.setSources([source]);
    drain();
    writeFileSync(source.file, [user("u9", base + 2, "replacement needle content, longer than before, with more words"), user("u8", base + 3, "x")].join(""));
    index.setSources([source]);
    drain();
    assert.deepEqual(ids(search("needle").hits), ["c:u9"]);
    assert.deepEqual(search("original").hits, []);
    // A shorter file than what was read is also a rewrite.
    writeFileSync(source.file, user("u7", base + 4, "tiny needle"));
    index.setSources([source]);
    drain();
    assert.deepEqual(ids(search("needle").hits), ["c:u7"]);
  });

  it("forgets chats that are no longer listed or whose file is gone", () => {
    const a = chat("a", [user("u1", base, "needle a")]);
    const b = chat("b", [user("u2", base + 1, "needle b")]);
    index.setSources([a, b]);
    drain();
    assert.equal(search("needle").hits.length, 2);
    index.setSources([a]);
    assert.deepEqual(ids(search("needle").hits), ["a:u1"]);
    rmSync(a.file);
    index.setSources([a]);
    assert.deepEqual(search("needle").hits, []);
  });

  it("shows the current title and archive state without reading the file again", () => {
    const source = chat("c", [user("u1", base, "needle")], { title: "Before" });
    index.setSources([source]);
    drain();
    assert.equal(search("needle").hits[0]!.title, "Before");
    index.setSources([{ ...source, title: "After", archived: true }]);
    assert.equal(index.status().indexing, false);
    const [hit] = search("needle").hits;
    assert.equal(hit!.title, "After");
    assert.equal(hit!.archived, true);
    assert.deepEqual(search("needle", { includeArchived: false }).hits, []);
  });

  it("searches an index that is still being built", () => {
    const lines = Array.from({ length: 3000 }, (_, n) => user(`u${n}`, base + n * 1000, `needle ${n} ${"filler ".repeat(40)}`));
    index.setSources([chat("c", lines)]);
    assert.equal(index.indexSlice(), true);
    const partial = search("needle").hits;
    assert.ok(partial.length > 0 && partial.length <= 50);
    drain();
    const total = search("needle").hits.length;
    assert.equal(total, 50);
    assert.ok(search("needle 2999").hits.length === 1);
  });

  it("indexes the most recently updated chats first", () => {
    index.setSources([
      chat("stale", [user("u1", base, "needle stale")], { updated: base }),
      chat("fresh", [user("u2", base + 1, "needle fresh")], { updated: base + 100 }),
    ]);
    while (index.status().indexed < 1) index.indexSlice();
    assert.deepEqual(ids(search("needle").hits), ["fresh:u2"]);
  });

  it("keeps every message that shares a second", () => {
    const lines = Array.from({ length: 40 }, (_, n) => user(`u${n}`, base + n, "same second needle"));
    index.setSources([chat("c", lines)]);
    drain();
    assert.equal(search("needle").hits.length, 40);
    assert.equal(new Set(search("needle").hits.map(hit => hit.cursor)).size, 40);
  });

  it("skips a record too large to be text and carries on", () => {
    const huge = message("big", base, { role: "toolResult", toolCallId: "c", toolName: "bash", content: [{ type: "image", data: "A".repeat(3 * 1024 * 1024) }] });
    index.setSources([chat("c", [user("u1", base, "before needle"), huge, user("u2", base + 1000, "after needle")])]);
    drain();
    assert.deepEqual(ids(search("needle").hits), ["c:u2", "c:u1"]);
  });

  it("drops a line longer than the limit, even when it spans several reads, and reads on after it", () => {
    index.close();
    index = SearchIndex.open(join(dir, "small-limit.sqlite"), { maxLineBytes: 1_500_000 });
    const huge = message("big", base, { role: "toolResult", toolCallId: "c", toolName: "bash", content: [{ type: "text", text: `lost needle ${"A".repeat(3_200_000)}` }] });
    index.setSources([chat("c", [user("u1", base, "before needle"), huge, user("u2", base + 1000, "after needle"), user("u3", base + 2000, "last needle")])]);
    drain();
    assert.deepEqual(ids(search("needle").hits), ["c:u3", "c:u2", "c:u1"]);
  });

  it("rebuilds a database written by another schema version", () => {
    index.close();
    const path = join(dir, "other.sqlite");
    const old = new DatabaseSync(path);
    old.exec("CREATE TABLE conv(x); PRAGMA user_version = 99");
    old.close();
    index = SearchIndex.open(path);
    index.setSources([chat("c", [user("u1", base, "needle")])]);
    drain();
    assert.deepEqual(ids(search("needle").hits), ["c:u1"]);
  });

  it("has nothing to search for without keywords", () => {
    assert.equal(index.search({ query: "   ", filters: all }), null);
    assert.equal(index.search({ query: '""', filters: all }), null);
  });
});

describe("buildSnippet", () => {
  it("marks every match, ignoring case, and trims to one line around the first", () => {
    const text = `${"lead ".repeat(30)}Error: ENOENT\nno such file ${"tail ".repeat(60)}`;
    const snippet = buildSnippet(text, ["enoent", "FILE"]);
    assert.ok(snippet.startsWith("…"));
    assert.ok(snippet.endsWith("…"));
    assert.ok(snippet.includes("\u0001ENOENT\u0002"));
    assert.ok(snippet.includes("\u0001file\u0002"));
    assert.ok(!snippet.includes("\n"));
    assert.ok(snippet.length < 260);
  });

  it("merges overlapping matches", () => {
    assert.equal(buildSnippet("abcdef", ["abcd", "cdef"]), "\u0001abcdef\u0002");
  });

  it("shows the start of the text when nothing can be marked", () => {
    assert.equal(buildSnippet("plain text", ["zzz"]), "plain text");
  });
});
