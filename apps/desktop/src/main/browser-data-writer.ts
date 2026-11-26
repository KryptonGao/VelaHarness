import { WebContentsView, type Session } from "electron";
import type { BrowserImportResult } from "../../../../packages/shared/src/browser";
import type { BrowserImportData } from "./browser-data-file";

// Chromium commits this static document with baseURLForDataURL as its origin.
// Loading a data URL avoids requesting a website or running its service worker.
const blankDocument = "data:text/html," + encodeURIComponent(
  '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'"><title></title>',
);
const activeWrites = new WeakSet<Session>();
const stallTimeoutMs = 180_000;

async function applyBrowserData(session: Session, data: BrowserImportData, signal: AbortSignal, progress: () => void): Promise<BrowserImportResult> {
  const result = { cookies: 0, localStorage: 0, skipped: data.skipped };
  let view: WebContentsView | undefined;
  const closeDocument = () => {
    if (view && !view.webContents.isDestroyed()) view.webContents.close();
    view = undefined;
  };
  signal.addEventListener("abort", closeDocument, { once: true });
  try {
    for (const cookie of data.cookies) {
      signal.throwIfAborted();
      // An expired cookie would delete an existing cookie with the same identity.
      if (cookie.expirationDate !== undefined && cookie.expirationDate <= Date.now() / 1000) {
        result.skipped++;
        continue;
      }
      try {
        await session.cookies.set(cookie);
        result.cookies++;
      } catch { result.skipped++; }
      progress();
    }
    for (const site of data.origins) {
      signal.throwIfAborted();
      if (!site.localStorage.length) continue;
      let written = 0;
      try {
        const url = new URL(site.origin);
        if ((url.protocol !== "http:" && url.protocol !== "https:") || url.origin !== site.origin) {
          result.skipped += site.localStorage.length;
          continue;
        }
        view ??= new WebContentsView({ webPreferences: {
          session, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true,
        } });
        const contents = view.webContents;
        await contents.loadURL(blankDocument, { baseURLForDataURL: url.origin + "/" });
        signal.throwIfAborted();
        const code = `(() => {
          if (globalThis.origin !== ${JSON.stringify(url.origin)}) return 0;
          let written = 0;
          for (const { name, value } of ${JSON.stringify(site.localStorage)}) {
            try { localStorage.setItem(name, value); written++; } catch { /* Quota or storage access failure. */ }
          }
          return written;
        })()`;
        written = await contents.executeJavaScriptInIsolatedWorld(1, [{ code }]);
      } catch { closeDocument(); }
      result.localStorage += written;
      result.skipped += site.localStorage.length - written;
      progress();
    }
  } finally {
    closeDocument();
    signal.removeEventListener("abort", closeDocument);
    session.flushStorageData();
    if (result.cookies) await session.cookies.flushStore();
  }
  signal.throwIfAborted();
  return result;
}

export async function writeBrowserData(session: Session, data: BrowserImportData): Promise<BrowserImportResult> {
  if (activeWrites.has(session)) throw new Error("BROWSER_IMPORT_BUSY");
  activeWrites.add(session);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Native cookie writes cannot be cancelled. Keep the session locked until the
    // in-flight mutation settles, even when the caller has already received a timeout.
    const stalled = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        const error = new Error("Browser data import timed out. Some changes may have been applied.");
        controller.abort(error);
        reject(error);
      }, stallTimeoutMs);
    });
    const task = applyBrowserData(session, data, controller.signal, () => {
      if (!controller.signal.aborted) timer?.refresh();
    }).finally(() => activeWrites.delete(session));
    return await Promise.race([task, stalled]);
  } finally {
    clearTimeout(timer);
  }
}
