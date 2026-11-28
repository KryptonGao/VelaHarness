export type UiStorageEntry = [key: string, value: string | null];

export type UiStorageTransport = {
  /** One synchronous round trip returning the whole store. */
  load(): Record<string, string | null>;
  /** Asynchronous batch write; resolves with a message per entry the main process rejected. */
  write(entries: UiStorageEntry[]): Promise<string[]>;
  /** Blocking batch write, used only while the page is going away. */
  writeSync(entries: UiStorageEntry[]): void;
  reportError(message: string, error: unknown): void;
};

export type CachedUiStorageOptions = {
  delayMs?: number;
  /** Keys the main process acts on; they are sent at once so later requests from this page see them. */
  immediate?: (key: string) => boolean;
  /** Throws for a value the main process would refuse, so the caller still gets a synchronous error. */
  validate?: (key: string, value: string | null) => void;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

/**
 * Reads come from memory after a single startup load. Writes update memory first and reach the
 * main process in trailing-debounced batches, so the renderer never waits on disk or IPC.
 */
export function createCachedUiStorage(transport: UiStorageTransport, options: CachedUiStorageOptions = {}) {
  const delayMs = options.delayMs ?? 100;
  const setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let cache: Map<string, string | null> | undefined;
  const pending = new Map<string, string | null>();
  let timer: unknown;

  const records = () => cache ??= new Map(Object.entries(transport.load()));

  const takePending = (): UiStorageEntry[] => {
    if (timer !== undefined) { clearTimer(timer); timer = undefined; }
    const entries = [...pending];
    pending.clear();
    return entries;
  };

  function flush(): void {
    const entries = takePending();
    if (entries.length === 0) return;
    transport.write(entries).then(
      (errors) => { for (const message of errors) transport.reportError(`UI storage write rejected: ${message}`, undefined); },
      (error) => transport.reportError("UI storage write failed", error),
    );
  }

  /** Blocking variant for page unload, where an asynchronous call could be dropped. */
  function flushSync(): void {
    const entries = takePending();
    if (entries.length === 0) return;
    try { transport.writeSync(entries); }
    catch (error) { transport.reportError("UI storage write failed", error); }
  }

  function write(key: string, value: string | null): void {
    if (typeof key !== "string" || !key.startsWith("vela.") || key.length > 200) throw new Error("Invalid UI storage key");
    if (value !== null && typeof value !== "string") throw new Error("Invalid UI storage value");
    options.validate?.(key, value);
    const store = records();
    if (store.has(key) && store.get(key) === value) return;
    store.set(key, value);
    pending.set(key, value);
    if (options.immediate?.(key)) flush();
    else timer ??= setTimer(flush, delayMs);
  }

  return {
    getItem(key: string): string | null | undefined {
      return records().get(key);
    },
    setItem(key: string, value: string): void { write(key, value); },
    removeItem(key: string): void { write(key, null); },
    flush,
    flushSync,
  };
}
