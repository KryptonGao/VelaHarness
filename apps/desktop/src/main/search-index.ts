import { createHash } from "node:crypto";
import { closeSync, fstatSync, openSync, readSync, rmSync, statSync } from "node:fs";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import {
  parseSearchQuery,
  snippetClose,
  snippetOpen,
  type ConversationSearchHit,
  type ConversationSearchIndexStatus,
  type ConversationSearchKind,
  type ConversationSearchRequest,
} from "@vela/shared";
import { extractRows, searchKinds } from "./search-extract";

/**
 * Full-text index over the message text and tool output stored in session files.
 *
 * - One FTS5 table with the trigram tokenizer: any substring of three or more characters
 *   matches, in any language, with no word segmentation. Shorter keywords are matched with LIKE.
 * - A row's id is its time: `second * slots + n`. Walking ids downward is walking the chats
 *   newest first with no sort, a date filter is a range on the id, and a page continues from
 *   the last id it returned.
 * - Session files only grow, so each one is read from where the previous pass stopped. A short
 *   fingerprint of the bytes before that offset detects a rewritten file and restarts it.
 * - All work is cut into slices of a few milliseconds so one process can interleave indexing
 *   with searches: a search never waits for indexing, and results leave as soon as a slice finds them.
 *
 * The database is a cache of the session files. A different schema version rebuilds it.
 */

const schemaVersion = 1;
/** Ids per second. 2^20 slots keeps every id below 2^53, so ids are exact JS numbers. */
const slots = 1 << 20;
const chunkBytes = 1 << 20;
/** A line this long holds an embedded file, not text. It is skipped. */
const defaultMaxLineBytes = 64 << 20;
const guardBytes = 64;
/** Indexing slice limits: text inserted and wall time. */
const sliceTextBytes = 200_000;
const sliceMs = 40;

export interface SearchSource {
  id: string;
  file: string;
  /** Project path, or "" for a chat without one. */
  workspace: string;
  title: string;
  archived: boolean;
  updated: number;
}

interface ConvRow {
  id: string;
  file: string;
  offset: number;
  guard: string;
  updated: number;
}

interface Job {
  conv: ConvRow;
  fd: number;
  /** Offset of the first byte of `carry` in the file. */
  offset: number;
  carry: Buffer;
  eof: boolean;
  /** Dropping the rest of an over-long line. */
  skipping: boolean;
}

export class SearchIndex {
  private readonly db: DatabaseSync;
  private readonly stmt: Record<string, StatementSync> = {};
  private queue: string[] = [];
  private job: Job | null = null;
  private total = 0;
  private done = 0;
  private sources = new Map<string, SearchSource>();

  private constructor(db: DatabaseSync, private readonly maxLineBytes: number) {
    this.db = db;
    db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA temp_store = MEMORY");
    this.prepare();
  }

  static open(path: string, options: { maxLineBytes?: number } = {}): SearchIndex {
    const maxLineBytes = options.maxLineBytes ?? defaultMaxLineBytes;
    try {
      const db = new DatabaseSync(path);
      const version = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
      if (version === schemaVersion) return new SearchIndex(db, maxLineBytes);
      db.close();
    } catch { /* unreadable or damaged: rebuild below */ }
    for (const suffix of ["", "-wal", "-shm"]) rmSync(path + suffix, { force: true });
    const db = new DatabaseSync(path);
    db.exec(`
      CREATE TABLE conv(
        id TEXT PRIMARY KEY, file TEXT NOT NULL, workspace TEXT NOT NULL, title TEXT NOT NULL,
        archived INTEGER NOT NULL, updated INTEGER NOT NULL,
        offset INTEGER NOT NULL DEFAULT 0, guard TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE entry(
        id INTEGER PRIMARY KEY, conv TEXT NOT NULL, eid TEXT NOT NULL, call TEXT, kind INTEGER NOT NULL, ts INTEGER NOT NULL
      );
      CREATE INDEX entry_conv ON entry(conv);
      CREATE VIRTUAL TABLE doc USING fts5(text, tokenize = 'trigram');
      PRAGMA user_version = ${schemaVersion};
    `);
    return new SearchIndex(db, maxLineBytes);
  }

  close(): void {
    this.dropJob();
    try { this.db.close(); } catch { /* already closed */ }
  }

  private prepare(): void {
    const p = (name: string, sql: string) => { this.stmt[name] = this.db.prepare(sql); };
    p("conv", "SELECT id, file, offset, guard, updated FROM conv");
    p("convOne", "SELECT id, file, offset, guard, updated FROM conv WHERE id = ?");
    p("upsert", `INSERT INTO conv(id, file, workspace, title, archived, updated) VALUES(?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET file = excluded.file, workspace = excluded.workspace, title = excluded.title,
        archived = excluded.archived, updated = excluded.updated`);
    p("progress", "UPDATE conv SET offset = ?, guard = ? WHERE id = ?");
    p("entryIds", "SELECT id FROM entry WHERE conv = ?");
    p("delDoc", "DELETE FROM doc WHERE rowid = ?");
    p("delEntries", "DELETE FROM entry WHERE conv = ?");
    p("delConv", "DELETE FROM conv WHERE id = ?");
    p("taken", "SELECT 1 FROM entry WHERE id = ?");
    p("addEntry", "INSERT INTO entry(id, conv, eid, call, kind, ts) VALUES(?, ?, ?, ?, ?, ?)");
    p("addDoc", "INSERT INTO doc(rowid, text) VALUES(?, ?)");
  }

  // ----- Following the chat list -----

  /**
   * Make the index follow `sources`: record their current titles and archive state, forget
   * chats that are gone, and queue the files that grew, newest chat first.
   */
  setSources(sources: readonly SearchSource[]): void {
    this.sources = new Map(sources.map(source => [source.id, source]));
    // The queue is rebuilt from what is committed; a half-read file is picked up again from its last offset.
    this.dropJob();
    const known = new Map((this.stmt.conv!.all() as unknown as ConvRow[]).map(row => [row.id, row]));
    const queue: { id: string; updated: number }[] = [];
    this.db.exec("BEGIN");
    try {
      for (const id of known.keys()) {
        if (!this.sources.has(id)) this.purge(id);
      }
      for (const source of sources) {
        this.stmt.upsert!.run(source.id, source.file, source.workspace, source.title, source.archived ? 1 : 0, source.updated);
        const row = known.get(source.id);
        let size: number;
        try { size = statSync(source.file).size; } catch { if (row) this.purge(source.id); continue; }
        if (row && row.file !== source.file) this.reset(source.id);
        const offset = row && row.file === source.file ? row.offset : 0;
        if (size > offset || (offset > 0 && size < offset)) queue.push({ id: source.id, updated: source.updated });
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    queue.sort((a, b) => b.updated - a.updated);
    this.queue = queue.map(item => item.id);
    this.total = this.queue.length;
    this.done = 0;
  }

  status(): ConversationSearchIndexStatus {
    return { indexing: this.queue.length > 0 || this.job !== null, indexed: this.done, total: this.total };
  }

  private purge(id: string): void {
    this.reset(id);
    this.stmt.delConv!.run(id);
  }

  /** Forget everything read from a chat so its file is read again from the start. */
  private reset(id: string): void {
    for (const row of this.stmt.entryIds!.all(id) as { id: number }[]) this.stmt.delDoc!.run(row.id);
    this.stmt.delEntries!.run(id);
    this.stmt.progress!.run(0, "", id);
  }

  // ----- Indexing -----

  /** Index one slice of work. Returns false when there is nothing left to index. */
  indexSlice(): boolean {
    for (;;) {
      if (!this.job) {
        const id = this.queue.shift();
        if (id === undefined) return false;
        this.job = this.openJob(id);
        if (!this.job) { this.done += 1; continue; }
      }
      break;
    }
    const job = this.job!;
    const started = performance.now();
    let consumed = 0;
    let textBytes = 0;
    const fallback = this.sources.get(job.conv.id)?.updated ?? Date.now();
    const used = new Map<number, number>();
    this.db.exec("BEGIN");
    try {
      for (;;) {
        const newline = job.carry.indexOf(10, consumed);
        if (newline < 0) {
          if (!job.eof && this.readMore(job, consumed)) { consumed = 0; continue; }
          break;
        }
        if (job.skipping) {
          job.skipping = false;
          consumed = newline + 1;
          continue;
        }
        const line = job.carry.toString("utf8", consumed, newline);
        consumed = newline + 1;
        for (const row of extractRows(line)) {
          const id = this.allocate(Number.isFinite(row.timestamp) ? row.timestamp : fallback, used);
          const ts = Number.isFinite(row.timestamp) ? row.timestamp : fallback;
          this.stmt.addEntry!.run(id, job.conv.id, row.entryId, row.toolCallId, row.kind, ts);
          this.stmt.addDoc!.run(id, row.text);
          textBytes += row.text.length;
        }
        if (textBytes >= sliceTextBytes || performance.now() - started >= sliceMs) break;
      }
      job.offset += consumed;
      job.carry = job.carry.subarray(consumed);
      const guard = this.guardAt(job.fd, job.offset);
      this.stmt.progress!.run(job.offset, guard, job.conv.id);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      this.dropJob();
      this.done += 1;
      throw error;
    }
    const finished = job.eof && job.carry.indexOf(10) < 0;
    if (finished) {
      this.dropJob();
      this.done += 1;
    }
    return this.queue.length > 0 || this.job !== null;
  }

  /** Append the next chunk of the file to `carry`, first dropping the `consumed` bytes already used. */
  private readMore(job: Job, consumed: number): boolean {
    const rest = job.carry.subarray(consumed);
    const chunk = Buffer.allocUnsafe(chunkBytes);
    const read = readSync(job.fd, chunk, 0, chunkBytes, job.offset + job.carry.length);
    if (read === 0) { job.eof = true; return false; }
    if (job.skipping && chunk.subarray(0, read).indexOf(10) < 0) {
      // Still inside the over-long line.
      job.offset += job.carry.length + read;
      job.carry = Buffer.alloc(0);
      return true;
    }
    job.offset += consumed;
    job.carry = Buffer.concat([rest, chunk.subarray(0, read)]);
    if (job.carry.length > this.maxLineBytes && job.carry.indexOf(10) < 0) {
      job.offset += job.carry.length;
      job.carry = Buffer.alloc(0);
      job.skipping = true;
    }
    return true;
  }

  private openJob(id: string): Job | null {
    const row = this.stmt.convOne!.get(id) as unknown as ConvRow | undefined;
    if (!row) return null;
    let fd: number;
    try { fd = openSync(row.file, "r"); } catch { return null; }
    try {
      let offset = row.offset;
      if (offset > 0 && (fstatSync(fd).size < offset || this.guardAt(fd, offset) !== row.guard)) {
        // Rewritten or replaced: read it again from the start.
        this.db.exec("BEGIN");
        try { this.reset(id); this.db.exec("COMMIT"); } catch (error) { this.db.exec("ROLLBACK"); throw error; }
        offset = 0;
      }
      return { conv: row, fd, offset, carry: Buffer.alloc(0), eof: false, skipping: false };
    } catch (error) {
      closeSync(fd);
      throw error;
    }
  }

  private dropJob(): void {
    if (!this.job) return;
    try { closeSync(this.job.fd); } catch { /* already closed */ }
    this.job = null;
  }

  private guardAt(fd: number, offset: number): string {
    if (offset <= 0) return "";
    const length = Math.min(offset, guardBytes);
    const buffer = Buffer.allocUnsafe(length);
    const read = readSync(fd, buffer, 0, length, offset - length);
    return createHash("sha1").update(buffer.subarray(0, read)).digest("hex");
  }

  /** The next free id in the second of `timestamp`. `used` remembers where the last one in a second went. */
  private allocate(timestamp: number, used: Map<number, number>): number {
    const second = Math.floor(timestamp / 1000);
    let slot = used.get(second) ?? 0;
    for (;;) {
      const id = second * slots + slot;
      slot += 1;
      if (this.stmt.taken!.get(id) === undefined) {
        used.set(second, slot);
        return id;
      }
    }
  }

  // ----- Searching -----

  /** Start a search; call `step()` until it reports `done`. Returns null when the query has no keywords. */
  search(request: ConversationSearchRequest): SearchRun | null {
    const keywords = parseSearchQuery(request.query);
    return keywords.length ? new SearchRun(this.db, keywords, request) : null;
  }
}

const pageSize = 50;
const sliceRows = 20;
const hour = 3600 * slots;
const day = 24 * hour;

export interface SearchStep {
  hits: ConversationSearchHit[];
  /** The search has produced everything it will: a full page, or nothing older matches. */
  done: boolean;
  /** Cursor of the next page; null when nothing older matches. */
  next: number | null;
}

interface HitRow {
  id: number;
  conv: string;
  eid: string;
  call: string | null;
  kind: number;
  ts: number;
  title: string;
  workspace: string;
  archived: number;
  text: string;
}

/** One search, advanced a bounded window of the timeline at a time. */
export class SearchRun {
  private cursor: number;
  private lowest: number;
  /** Width of the next window of the timeline, in ids. */
  private span: number;
  private emitted = 0;
  private readonly statement: StatementSync;
  private readonly parameters: (string | number)[];
  private readonly lowerOffset: number;

  constructor(db: DatabaseSync, private readonly keywords: string[], request: ConversationSearchRequest) {
    const { filters } = request;
    const bounds = db.prepare("SELECT min(id) AS lo, max(id) AS hi FROM entry").get() as { lo: number | null; hi: number | null };
    const empty = bounds.lo === null || bounds.hi === null;
    this.lowest = empty ? 0 : Math.max(bounds.lo!, filters.from !== undefined ? Math.floor(filters.from / 1000) * slots : 0);
    const newest = empty ? 0 : bounds.hi! + 1;
    this.cursor = Math.min(request.after ?? newest, newest, filters.to !== undefined ? Math.ceil(filters.to / 1000) * slots : newest);

    // Keywords of three or more characters go to the full-text index; shorter ones can only be matched by scanning.
    const indexed = keywords.filter(keyword => [...keyword].length >= 3);
    const scanned = keywords.filter(keyword => [...keyword].length < 3);
    const where: string[] = [];
    this.parameters = [];
    if (indexed.length) {
      where.push("doc MATCH ?");
      this.parameters.push(indexed.map(keyword => `"${keyword.replaceAll('"', '""')}"`).join(" AND "));
    }
    where.push("doc.rowid >= ? AND doc.rowid < ?");
    this.lowerOffset = this.parameters.length;
    this.parameters.push(0, 0);
    for (const keyword of scanned) {
      where.push("doc.text LIKE ? ESCAPE '\\'");
      this.parameters.push(`%${keyword.replace(/[\\%_]/g, "\\$&")}%`);
    }
    if (!filters.includeArchived) where.push("c.archived = 0");
    if (!filters.includeTools) where.push(`e.kind < ${searchKinds.tool}`);
    if (filters.workspace !== undefined) { where.push("c.workspace = ?"); this.parameters.push(filters.workspace); }
    if (filters.from !== undefined) { where.push("e.ts >= ?"); this.parameters.push(filters.from); }
    if (filters.to !== undefined) { where.push("e.ts < ?"); this.parameters.push(filters.to); }
    // CROSS JOIN keeps the full-text table as the outer loop, so rows stream in id order.
    // Scanning reads every row in the window; indexed lookups only touch the matches.
    this.span = (indexed.length ? 3 : 1) * day;
    this.statement = db.prepare(`
      SELECT e.id, e.conv, e.eid, e.call, e.kind, e.ts, c.title, c.workspace, c.archived, doc.text
      FROM doc CROSS JOIN entry e ON e.id = doc.rowid CROSS JOIN conv c ON c.id = e.conv
      WHERE ${where.join(" AND ")}
      ORDER BY doc.rowid DESC LIMIT ?`);
  }

  step(): SearchStep {
    if (this.cursor <= this.lowest) return { hits: [], done: true, next: null };
    const lo = Math.max(this.lowest, this.cursor - this.span);
    const limit = Math.min(sliceRows, pageSize - this.emitted);
    const started = performance.now();
    this.parameters[this.lowerOffset] = lo;
    this.parameters[this.lowerOffset + 1] = this.cursor;
    const rows = this.statement.all(...this.parameters, limit) as unknown as HitRow[];
    const elapsed = performance.now() - started;
    // Keep each slice short: shrink the window when it was slow, widen it while it finds nothing.
    if (elapsed > 25) this.span = Math.max(hour, Math.floor(this.span / 4));
    else if (elapsed < 8 && rows.length === 0) this.span *= 4;
    this.cursor = rows.length === limit ? rows[rows.length - 1]!.id : lo;
    this.emitted += rows.length;
    const hits = rows.map(row => toHit(row, this.keywords));
    if (this.emitted >= pageSize) return { hits, done: true, next: this.cursor > this.lowest ? this.cursor : null };
    if (this.cursor <= this.lowest) return { hits, done: true, next: null };
    return { hits, done: false, next: this.cursor };
  }
}

const kindNames: ConversationSearchKind[] = ["user", "assistant", "tool"];

function toHit(row: HitRow, keywords: readonly string[]): ConversationSearchHit {
  return {
    cursor: row.id,
    conversationId: row.conv,
    title: row.title,
    workspace: row.workspace,
    archived: row.archived === 1,
    entryId: row.eid,
    toolCallId: row.call,
    kind: kindNames[row.kind] ?? "assistant",
    timestamp: row.ts,
    snippet: buildSnippet(row.text, keywords),
  };
}

const before = 48;
const windowLength = 200;

/**
 * One line of `text` around the first match, with every match marked. Matching ignores case.
 * Falls back to the start of the text if case folding changed its length.
 */
export function buildSnippet(text: string, keywords: readonly string[]): string {
  const lower = text.toLowerCase();
  const comparable = lower.length === text.length;
  const needles = keywords.map(keyword => keyword.toLowerCase()).filter(Boolean);
  let first = -1;
  if (comparable) {
    for (const needle of needles) {
      const index = lower.indexOf(needle);
      if (index >= 0 && (first < 0 || index < first)) first = index;
    }
  }
  let start = Math.max(0, first - before);
  // Do not begin inside a surrogate pair.
  if (start > 0 && /[\uDC00-\uDFFF]/.test(text[start]!)) start -= 1;
  const end = Math.min(text.length, start + windowLength);
  const slice = text.slice(start, end);
  let marked = slice;
  if (comparable) {
    const ranges: [number, number][] = [];
    const lowerSlice = lower.slice(start, end);
    for (const needle of needles) {
      for (let at = lowerSlice.indexOf(needle); at >= 0; at = lowerSlice.indexOf(needle, at + needle.length)) {
        ranges.push([at, at + needle.length]);
      }
    }
    ranges.sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const range of ranges) {
      const last = merged[merged.length - 1];
      if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
      else merged.push([...range]);
    }
    let output = "";
    let position = 0;
    for (const [from, to] of merged) {
      output += slice.slice(position, from) + snippetOpen + slice.slice(from, to) + snippetClose;
      position = to;
    }
    marked = output + slice.slice(position);
  }
  const line = marked.replace(/\s+/g, " ");
  return `${start > 0 ? "…" : ""}${line}${end < text.length ? "…" : ""}`;
}
