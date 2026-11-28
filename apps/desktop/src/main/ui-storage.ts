import { readFileSync, renameSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const maxBytes = 16 * 1024 * 1024;

export type UiStorageOptions = {
  /** Trailing debounce for disk writes. 0 writes through on every change. */
  writeDelayMs?: number;
  /** Called when a deferred write fails; the data stays dirty and is retried on the next flush. */
  onWriteError?: (error: unknown) => void;
};

/**
 * Renderer preferences and summaries live beside conversations, independent of page origin.
 * The parsed file is kept in memory (this process is its only writer) and written back in
 * coalesced batches; call `flush()` before the process exits.
 */
export class UiStorage {
  private records: Record<string, string | null> | undefined;
  private bytes = 0;
  private dirty = false;
  private timer: NodeJS.Timeout | undefined;
  private readonly writeDelayMs: number;
  private readonly onWriteError?: (error: unknown) => void;

  constructor(private readonly file: string, options: UiStorageOptions = {}) {
    this.writeDelayMs = options.writeDelayMs ?? 0;
    this.onWriteError = options.onWriteError;
  }

  private load(): Record<string, string | null> {
    if (this.records) return this.records;
    let raw: string;
    try {
      raw = readFileSync(this.file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return this.adopt({});
      throw error;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid UI storage");
    const entries = Object.entries(parsed);
    if (entries.some(([key, value]) => !key.startsWith("vela.") || (value !== null && typeof value !== "string"))) {
      throw new Error("Invalid UI storage entry");
    }
    return this.adopt(Object.fromEntries(entries));
  }

  private adopt(records: Record<string, string | null>): Record<string, string | null> {
    this.records = records;
    this.bytes = 2 + Object.entries(records).reduce((sum, [key, value]) => sum + entryBytes(key, value), 0);
    return records;
  }

  getItem(key: unknown): string | null | undefined {
    this.validateKey(key);
    return this.load()[key];
  }

  /** Every stored entry, for the renderer's startup snapshot. */
  snapshot(): Record<string, string | null> {
    return { ...this.load() };
  }

  setItem(key: unknown, value: unknown): void {
    this.validateKey(key);
    if (value !== null && typeof value !== "string") throw new Error("Invalid UI storage value");
    const records = this.load();
    if (Object.hasOwn(records, key) && records[key] === value) return;
    const nextBytes = this.bytes - (Object.hasOwn(records, key) ? entryBytes(key, records[key]) : 0) + entryBytes(key, value);
    if (nextBytes > maxBytes) throw new Error("UI storage quota exceeded");
    records[key] = value;
    this.bytes = nextBytes;
    this.dirty = true;
    if (this.writeDelayMs <= 0) this.flush();
    else this.timer ??= setTimeout(() => this.flushDeferred(), this.writeDelayMs);
  }

  /** Write pending changes to disk synchronously. Safe to call when nothing is pending. */
  flush(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    if (!this.dirty || !this.records) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify(this.records), { encoding: "utf8", mode: 0o600 });
      renameSync(temporary, this.file);
      this.dirty = false;
    } finally {
      rmSync(temporary, { force: true });
    }
  }

  private flushDeferred(): void {
    this.timer = undefined;
    try { this.flush(); }
    catch (error) { this.onWriteError?.(error); }
  }

  private validateKey(key: unknown): asserts key is string {
    if (typeof key !== "string" || !key.startsWith("vela.") || key.length > 200) {
      throw new Error("Invalid UI storage key");
    }
  }
}

function entryBytes(key: string, value: string | null): number {
  return Buffer.byteLength(JSON.stringify(key), "utf8") + Buffer.byteLength(JSON.stringify(value), "utf8") + 2;
}
