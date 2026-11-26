import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent, type Session, type WebContents } from "electron";
import { BrowserIpc } from "../../../../packages/shared/src/browser";
import { captureChromeData } from "./browser-data-capture";
import { getImportSites, parseBrowserData, selectBrowserData, type StagedBrowserData } from "./browser-data-file";
import { writeBrowserData } from "./browser-data-writer";
import type { BrowserHost } from "./browser-host";

const maxImportBytes = 32 * 1024 * 1024;

async function readImportFile(path: string): Promise<Buffer> {
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile()) throw new Error("BROWSER_IMPORT_INVALID_FILE");
    const size = stat.size;
    if (size > maxImportBytes) throw new Error("BROWSER_IMPORT_TOO_LARGE");
    // Bound the read even if another process grows the file after stat().
    const buffer = Buffer.alloc(size);
    let offset = 0;
    while (offset < size) {
      const { bytesRead } = await file.read(buffer, offset, size - offset, offset);
      if (!bytesRead) throw new Error("BROWSER_IMPORT_INVALID_FILE");
      offset += bytesRead;
    }
    return buffer;
  } finally {
    await file.close();
  }
}

async function loadFile(path: string, expectedDigest?: string) {
  let bytes: Buffer;
  try {
    bytes = await readImportFile(path);
  } catch (error) {
    if (error instanceof Error && error.message === "BROWSER_IMPORT_TOO_LARGE") throw error;
    // Filesystem and JSON errors may contain a path or part of the original file.
    throw new Error("BROWSER_IMPORT_INVALID_FILE");
  }
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (expectedDigest && digest !== expectedDigest) throw new Error("BROWSER_IMPORT_STALE");
  try {
    return { digest, data: parseBrowserData(JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""))) };
  } catch {
    throw new Error("BROWSER_IMPORT_INVALID_FILE");
  }
}

type Preview =
  | { id: string; source: "file"; path: string; digest: string }
  | { id: string; source: "chrome"; data: StagedBrowserData };

export function registerBrowserDataImport(host: BrowserHost, session: Session, rendererUrl: string): () => Promise<void> {
  const previews = new WeakMap<WebContents, Preview>();
  const choosing = new WeakSet<WebContents>();
  const observed = new WeakSet<WebContents>();
  let capture: { owner: WebContents; controller: AbortController; task: ReturnType<typeof captureChromeData> } | undefined;

  function requireOwner(event: IpcMainInvokeEvent): BrowserWindow {
    const win = BrowserWindow.fromWebContents(event.sender);
    const frame = event.senderFrame;
    if (!win || !frame || frame.url.split("#")[0] !== rendererUrl) throw new Error("BROWSER_IMPORT_FAILED");
    host.assertUiSender(win.id, event.sender, frame === event.sender.mainFrame);
    const owner = event.sender;
    if (!observed.has(owner)) {
      observed.add(owner);
      const discard = () => {
        previews.delete(owner);
        if (capture?.owner === owner) capture.controller.abort();
      };
      owner.on("did-navigate", discard);
      owner.on("render-process-gone", discard);
      owner.once("destroyed", discard);
    }
    return win;
  }

  ipcMain.handle(BrowserIpc.captureChrome, async event => {
    requireOwner(event);
    const owner = event.sender;
    if (capture || choosing.has(owner)) throw new Error("BROWSER_IMPORT_BUSY");
    const controller = new AbortController();
    const task = captureChromeData(controller.signal);
    capture = { owner, controller, task };
    try {
      const raw = await task;
      if (raw === null || controller.signal.aborted || owner.isDestroyed()) return null;
      requireOwner(event);
      if (Buffer.byteLength(JSON.stringify(raw)) > maxImportBytes) throw new Error("BROWSER_IMPORT_TOO_LARGE");
      const data = parseBrowserData(raw);
      const id = randomUUID();
      previews.set(owner, { id, source: "chrome", data });
      return { id, sites: getImportSites(data) };
    } catch (error) {
      if (controller.signal.aborted) return null;
      if (error instanceof Error && ["BROWSER_CHROME_UNAVAILABLE", "BROWSER_IMPORT_TOO_LARGE"].includes(error.message)) throw error;
      throw new Error("BROWSER_CHROME_FAILED");
    } finally {
      capture = undefined;
    }
  });

  ipcMain.handle(BrowserIpc.cancelChromeCapture, event => {
    requireOwner(event);
    if (capture?.owner === event.sender) capture.controller.abort();
  });

  ipcMain.handle(BrowserIpc.chooseImportFile, async event => {
    const win = requireOwner(event);
    const owner = event.sender;
    if (choosing.has(owner) || capture?.owner === owner) throw new Error("BROWSER_IMPORT_BUSY");
    choosing.add(owner);
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog(win, {
        properties: ["openFile"], filters: [{ name: "Chrome storageState JSON", extensions: ["json"] }],
      });
      if (canceled || !filePaths[0]) return null;
      const path = filePaths[0];
      const { data, digest } = await loadFile(path);
      if (owner.isDestroyed() || !event.senderFrame || event.senderFrame !== owner.mainFrame) return null;
      const id = randomUUID();
      previews.set(owner, { id, source: "file", path, digest });
      return { id, sites: getImportSites(data) };
    } finally {
      choosing.delete(owner);
    }
  });

  ipcMain.handle(BrowserIpc.cancelImport, (event, id: unknown) => {
    requireOwner(event);
    const preview = previews.get(event.sender);
    if (preview && preview.id === id) previews.delete(event.sender);
  });

  ipcMain.handle(BrowserIpc.importSiteData, async (event, id: unknown, sites: string[] | null) => {
    requireOwner(event);
    const owner = event.sender;
    const preview = previews.get(owner);
    if (!preview || preview.id !== id) throw new Error("BROWSER_IMPORT_STALE");
    const data = preview.source === "file" ? (await loadFile(preview.path, preview.digest)).data : preview.data;
    if (owner.isDestroyed() || previews.get(owner) !== preview) throw new Error("BROWSER_IMPORT_STALE");
    requireOwner(event);
    const selected = selectBrowserData(data, sites);
    previews.delete(owner);
    try {
      return await writeBrowserData(session, selected);
    } catch (error) {
      if (error instanceof Error && error.message === "BROWSER_IMPORT_BUSY") throw error;
      throw new Error("BROWSER_IMPORT_FAILED");
    }
  });
  return async () => {
    for (const channel of [BrowserIpc.captureChrome, BrowserIpc.cancelChromeCapture, BrowserIpc.chooseImportFile,
      BrowserIpc.cancelImport, BrowserIpc.importSiteData]) ipcMain.removeHandler(channel);
    if (capture) {
      capture.controller.abort();
      await capture.task.catch(() => {});
    }
  };
}
