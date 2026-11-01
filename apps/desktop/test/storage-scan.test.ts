import assert from "node:assert/strict";
import { link, mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { cleanLogs, cleanTraces, cleanUpdateStaging, deleteTrace, measurePath, readDisk, scanStorage } from "../src/main/storage-scan.ts";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "vela-storage-"));
  const home = join(root, "home");
  const userData = join(root, "user-data");
  for (const dir of ["traces", "sessions", "subagents/abc", "checkpoints/c1", "logs", "updates/staging", "skills", "worktrees"]) await mkdir(join(home, dir), { recursive: true });
  await mkdir(join(userData, "Cache"), { recursive: true });
  return { root, home, userData };
}
const bytes = (n: number) => "x".repeat(n);

test("measures hard-linked files once", async () => {
  const { root, home } = await fixture();
  try {
    await writeFile(join(home, "checkpoints/c1/blob"), bytes(100));
    await link(join(home, "checkpoints/c1/blob"), join(home, "checkpoints/c1/copy"));
    assert.deepEqual(await measurePath(join(home, "checkpoints")), { bytes: 100, files: 1 });
    assert.deepEqual(await measurePath(join(home, "missing")), { bytes: 0, files: 0 });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("sorts the data folder into categories and ranks conversations", async () => {
  const { root, home, userData } = await fixture();
  try {
    await writeFile(join(home, "traces/abc.jsonl"), bytes(500));
    await writeFile(join(home, "traces/def.jsonl"), bytes(50));
    await writeFile(join(home, "sessions/2026-01-01T00-00-00-000Z_abc.jsonl"), bytes(20));
    await writeFile(join(home, "subagents/abc/child.jsonl"), bytes(30));
    await writeFile(join(home, "conversations.json"), bytes(10));
    await writeFile(join(home, "auth.json"), bytes(7));
    await writeFile(join(userData, "Cache/data"), bytes(40));
    const overview = await scanStorage({ home, userData, titleOf: id => id === "abc" ? "Big chat" : null, traceInUse: id => id === "def" });
    const size = (id: string) => overview.categories.find(category => category.id === id)?.bytes;
    assert.equal(size("traces"), 550);
    assert.equal(size("conversations"), 30);
    assert.equal(size("subagents"), 30);
    assert.equal(size("cache"), 40);
    assert.equal(size("other"), 7);
    assert.equal(overview.totalBytes, 550 + 30 + 30 + 40 + 7);
    assert.deepEqual(overview.conversations.map(item => [item.id, item.title, item.bytes, item.traceBytes, item.traceInUse]), [
      ["abc", "Big chat", 550, 500, false],
      ["def", null, 50, 50, true],
    ]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("does not count the cache twice when the Electron data folder lives inside the home", async () => {
  const { root, home } = await fixture();
  try {
    const userData = join(home, "electron-data");
    await mkdir(join(userData, "Cache"), { recursive: true });
    await writeFile(join(userData, "Cache/data"), bytes(40));
    await writeFile(join(userData, "Preferences"), bytes(5));
    const overview = await scanStorage({ home, userData, titleOf: () => null, traceInUse: () => false });
    assert.equal(overview.categories.find(category => category.id === "cache")?.bytes, 40);
    assert.equal(overview.categories.find(category => category.id === "other")?.bytes, 5);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("trace cleanup keeps traces that are in use and rejects unsafe ids", async () => {
  const { root, home } = await fixture();
  try {
    await writeFile(join(home, "traces/a.jsonl"), bytes(10));
    await writeFile(join(home, "traces/b.jsonl"), bytes(20));
    const result = await cleanTraces(home, id => id === "b");
    assert.deepEqual(result, { freedBytes: 10, removedFiles: 1, skipped: 1 });
    assert.deepEqual(await readdir(join(home, "traces")), ["b.jsonl"]);

    assert.deepEqual(await deleteTrace(home, "b", () => true), { freedBytes: 0, removedFiles: 0, skipped: 1 });
    await assert.rejects(() => deleteTrace(home, "../sessions/x", () => false), /对话标识不正确/);
    assert.deepEqual(await deleteTrace(home, "b", () => false), { freedBytes: 20, removedFiles: 1, skipped: 0 });
    assert.deepEqual(await deleteTrace(home, "b", () => false), { freedBytes: 0, removedFiles: 0, skipped: 0 });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("log cleanup keeps files written today", async () => {
  const { root, home } = await fixture();
  try {
    const now = new Date(2026, 10, 1, 15, 0, 0);
    await writeFile(join(home, "logs/old.log"), bytes(8));
    await writeFile(join(home, "logs/today.log"), bytes(4));
    const old = new Date(2026, 9, 30);
    await utimes(join(home, "logs/old.log"), old, old);
    await utimes(join(home, "logs/today.log"), now, now);
    assert.deepEqual(await cleanLogs(home, now), { freedBytes: 8, removedFiles: 1, skipped: 1 });
    assert.deepEqual(await readdir(join(home, "logs")), ["today.log"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("update cleanup removes the staging folder and leaves the installer log", async () => {
  const { root, home } = await fixture();
  try {
    await writeFile(join(home, "updates/staging/Vela.zip"), bytes(64));
    await writeFile(join(home, "updates/installer.log"), bytes(3));
    assert.deepEqual(await cleanUpdateStaging(home), { freedBytes: 64, removedFiles: 1, skipped: 0 });
    assert.deepEqual(await readdir(join(home, "updates")), ["installer.log"]);
    assert.deepEqual(await cleanUpdateStaging(home), { freedBytes: 0, removedFiles: 0, skipped: 0 });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("reads the capacity of the disk the data folder lives on", async () => {
  const { root, home } = await fixture();
  try {
    const disk = await readDisk(home);
    assert.ok(disk.totalBytes > 0);
    assert.ok(disk.freeBytes >= 0 && disk.freeBytes <= disk.totalBytes);
  } finally { await rm(root, { recursive: true, force: true }); }
});
