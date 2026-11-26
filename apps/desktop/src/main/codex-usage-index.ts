import { createHash } from "node:crypto";
import { open, readdir, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createZstdDecompress } from "node:zlib";
import type { CodexUsageReport, CodexUsageBucket } from "@vela/shared";
import { newRollout, readRolloutLine, type RolloutState, type MeterReading } from "./codex-usage-rollout";

async function rolloutFiles(root: string, optional = true): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (optional && error.code === "ENOENT") return [];
    throw error;
  });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await rolloutFiles(path, false));
    else if (entry.isFile() && /\.jsonl(?:\.zst)?$/.test(entry.name)) files.push(path);
  }
  return files;
}

interface FileCursor {
  identity: string;
  size: number;
  modified: number;
  offset: number;
  guard: string;
  state: string;
}

// A file may have been truncated and regrown between refreshes on the same inode.
async function boundary(file: FileHandle, offset: number): Promise<string> {
  const length = Math.min(offset, 128);
  const { buffer, bytesRead } = await file.read(Buffer.alloc(length), 0, length, offset - length);
  return createHash("sha256").update(buffer.subarray(0, bytesRead)).digest("hex");
}

async function scanLines(file: FileHandle, start: number, size: number, compressed: boolean,
  state: RolloutState, add: (reading: MeterReading) => void): Promise<number> {
  if (size <= start) return start;
  const source = file.createReadStream({ start, end: size - 1, autoClose: false, highWaterMark: 256 * 1024 });
  const stream = compressed ? source.compose(createZstdDecompress()) : source;
  let offset = start;
  let pieces: Buffer[] = [];
  const consume = (tail: Buffer, final: boolean) => {
    const data = pieces.length ? Buffer.concat([...pieces, tail]) : tail;
    pieces = [];
    const line = data.toString("utf8");
    // Accept a complete last record without a newline. Retry a torn active record on append.
    if (final && !compressed) {
      try { JSON.parse(line); } catch { return; }
    }
    try {
      const reading = readRolloutLine(line, state);
      if (reading) add(reading);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      state.damaged = true;
    }
    offset += data.length + (final ? 0 : 1);
  };
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    let from = 0;
    for (let end = chunk.indexOf(10); end !== -1; end = chunk.indexOf(10, from)) {
      consume(chunk.subarray(from, end), false);
      from = end + 1;
    }
    if (from < chunk.length) pieces.push(chunk.subarray(from));
  }
  if (pieces.length) consume(Buffer.alloc(0), true);
  return compressed ? size : offset;
}

/** The worker owns this derived index. Each cursor commits with its readings. */
export async function syncCodexUsage(root: string, index: string): Promise<CodexUsageReport> {
  const paths = [...await rolloutFiles(join(root, "sessions")), ...await rolloutFiles(join(root, "archived_sessions"))];
  // SQLite inherits the permissions of the file created here.
  await (await open(index, "a", 0o600)).close();
  const db = new DatabaseSync(index);
  try {
    db.exec(`
      PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS files (
        path TEXT PRIMARY KEY, identity TEXT, size INTEGER, modified REAL, offset INTEGER, guard TEXT, state TEXT, damaged INTEGER
      );
      CREATE TABLE IF NOT EXISTS readings (
        path TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE, event TEXT, thread TEXT, ordinal INTEGER,
        cumulative INTEGER, baseThread TEXT, baseOrdinal INTEGER, time INTEGER, provider TEXT, model TEXT, tier TEXT,
        complete INTEGER, input INTEGER, output INTEGER, cacheRead INTEGER, cacheWrite INTEGER, totalTokens INTEGER,
        PRIMARY KEY(path, event)
      );
      CREATE INDEX IF NOT EXISTS inherited_readings ON readings(thread, cumulative, ordinal);
    `);
    const find = db.prepare("SELECT * FROM files WHERE path=?");
    const remove = db.prepare("DELETE FROM files WHERE path=?");
    const save = db.prepare("UPDATE files SET identity=?, size=?, modified=?, offset=?, guard=?, state=?, damaged=? WHERE path=?");
    const insert = db.prepare("INSERT OR IGNORE INTO readings VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    const failures = new Set<string>();
    for (const path of paths) {
      const file = await open(path, "r").catch(() => null);
      if (!file) { failures.add(path); continue; }
      try {
        const stat = await file.stat();
        const identity = `${stat.dev}:${stat.ino}`;
        const saved = find.get(path) as unknown as FileCursor | undefined;
        if (saved?.identity === identity && saved.size === stat.size && saved.modified === stat.mtimeMs) continue;
        const compressed = path.endsWith(".zst");
        const append = !compressed && saved?.identity === identity && saved.size < stat.size
          && saved.guard === await boundary(file, saved.offset);
        const state: RolloutState = append ? JSON.parse(saved.state) : newRollout();
        db.exec("BEGIN");
        try {
          if (!append) {
            remove.run(path);
            db.prepare("INSERT INTO files(path) VALUES (?)").run(path);
          }
          const offset = await scanLines(file, append ? saved.offset : 0, stat.size, compressed, state, reading => {
            const u = reading.usage;
            insert.run(path, reading.key, state.thread, reading.ordinal, reading.cumulative, reading.baseThread,
              reading.baseOrdinal, reading.time, reading.attributed ? state.provider : null, reading.attributed ? state.model : null,
              reading.attributed ? state.turnTier : null, Number(reading.complete),
              u.input, u.output, u.cacheRead, u.cacheWrite, u.totalTokens);
          });
          const after = await file.stat();
          if (after.size < stat.size || (after.size === stat.size && after.mtimeMs !== stat.mtimeMs)) {
            throw new Error("Codex rollout changed while being read");
          }
          const guard = compressed ? "" : await boundary(file, offset);
          save.run(identity, stat.size, stat.mtimeMs, offset, guard, JSON.stringify(state), Number(state.damaged), path);
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      } catch { failures.add(path); } finally { await file.close(); }
    }
    const present = new Set(paths);
    for (const { path } of db.prepare("SELECT path FROM files").all()) {
      if (!present.has(String(path))) remove.run(path);
    }
    // Mirrored/archive copies share event identities. A fork can also replay the exact
    // cumulative snapshot at its parent boundary before producing its own first request.
    const rows = db.prepare(`
      WITH unique_events AS (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY event ORDER BY complete DESC, path) AS rn
        FROM readings r WHERE baseThread IS NULL OR NOT EXISTS (
          SELECT 1 FROM readings p WHERE p.thread=r.baseThread AND p.ordinal<r.baseOrdinal AND p.cumulative=r.cumulative
        )
      )
      SELECT provider, model, tier, complete, MIN(time) AS timestamp, COUNT(*) AS requests,
        SUM(input) AS input, SUM(output) AS output, SUM(cacheRead) AS cacheRead,
        SUM(cacheWrite) AS cacheWrite, SUM(totalTokens) AS totalTokens
      FROM unique_events WHERE rn=1 GROUP BY date(time/1000, 'unixepoch', 'localtime'), provider, model, tier, complete
    `).all();
    const buckets: CodexUsageBucket[] = rows.map(row => ({
      provider: row.provider as string | null, model: row.model as string | null, tier: row.tier as string | null,
      timestamp: row.timestamp as number | null, complete: Boolean(row.complete), requests: Number(row.requests),
      usage: { input: Number(row.input), output: Number(row.output), cacheRead: Number(row.cacheRead),
        cacheWrite: Number(row.cacheWrite), totalTokens: Number(row.totalTokens) },
    }));
    for (const { path } of db.prepare("SELECT path FROM files WHERE damaged=1").all()) failures.add(String(path));
    return { buckets, incompleteFiles: failures.size };
  } finally {
    db.close();
  }
}

