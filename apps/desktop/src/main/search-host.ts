import { BrowserWindow, ipcMain, utilityProcess, type UtilityProcess, type WebContents } from "electron";
import {
  ConversationSearchIpc,
  createLogger,
  type ConversationSearchEvent,
  type ConversationSearchIndexStatus,
} from "@vela/shared";
import { parseRequestId, parseSearchRequest } from "./search-request";
import type { SearchSource } from "./search-index";
import type { SearchWorkerEvent, SearchWorkerRequest } from "./search-service";

const log = createLogger("search");

interface Options {
  workerPath: string;
  indexPath: string;
  /** The chats the index follows, read fresh on every sync. */
  sources: () => Promise<SearchSource[]>;
}

/**
 * Main-process side of conversation search. Indexing and searching run in a utility process;
 * this class forwards requests to it and pushes its hits to the window that asked, one batch
 * at a time as they are found.
 */
export class ConversationSearchHost {
  private worker: UtilityProcess | null = null;
  private status: ConversationSearchIndexStatus = { indexing: false, indexed: 0, total: 0 };
  /** Window waiting for each running search. */
  private readonly owners = new Map<string, WebContents>();

  constructor(private readonly options: Options) {}

  register(): void {
    ipcMain.handle(ConversationSearchIpc.sync, () => this.sync());
    ipcMain.handle(ConversationSearchIpc.start, (event, rawId: unknown, rawRequest: unknown) => {
      const requestId = parseRequestId(rawId);
      const request = parseSearchRequest(rawRequest);
      this.owners.set(requestId, event.sender);
      this.send({ t: "start", requestId, request });
    });
    ipcMain.handle(ConversationSearchIpc.cancel, (_event, rawId: unknown) => {
      const requestId = parseRequestId(rawId);
      if (this.owners.delete(requestId)) this.worker?.postMessage({ t: "cancel", requestId } satisfies SearchWorkerRequest);
    });
  }

  /** Hand the current chat list to the index and let it catch up in the background. */
  async sync(): Promise<ConversationSearchIndexStatus> {
    this.send({ t: "sync", sources: await this.options.sources() });
    return this.status;
  }

  dispose(): void {
    for (const channel of [ConversationSearchIpc.sync, ConversationSearchIpc.start, ConversationSearchIpc.cancel]) ipcMain.removeHandler(channel);
    this.owners.clear();
    const worker = this.worker;
    this.worker = null;
    worker?.kill();
  }

  private send(message: SearchWorkerRequest): void {
    this.ensureWorker().postMessage(message);
  }

  private ensureWorker(): UtilityProcess {
    if (this.worker) return this.worker;
    const worker = utilityProcess.fork(this.options.workerPath, [this.options.indexPath], { serviceName: "Vela search index", stdio: "ignore" });
    this.worker = worker;
    worker.on("message", (message: SearchWorkerEvent) => this.receive(message));
    worker.once("exit", code => {
      if (this.worker !== worker) return;
      this.worker = null;
      this.status = { indexing: false, indexed: 0, total: 0 };
      log.warn(`Search worker exited with code ${code}`);
      // Searches that were waiting on it cannot finish; the next sync or search starts a new worker.
      for (const [requestId] of this.owners) this.deliver(requestId, { type: "error", requestId, message: "Search stopped. Try again." });
      this.broadcast({ type: "index", ...this.status });
    });
    return worker;
  }

  private receive(message: SearchWorkerEvent): void {
    if (message.t === "status") {
      this.status = message.status;
      this.broadcast({ type: "index", ...message.status });
    } else if (message.t === "hits") {
      this.deliver(message.requestId, { type: "hits", requestId: message.requestId, hits: message.hits });
    } else if (message.t === "done") {
      this.deliver(message.requestId, { type: "done", requestId: message.requestId, next: message.next });
    } else if (message.requestId) {
      log.warn(`Search failed: ${message.message}`);
      this.deliver(message.requestId, { type: "error", requestId: message.requestId, message: message.message });
    } else {
      log.warn(`Search indexing: ${message.message}`);
    }
  }

  private deliver(requestId: string, event: ConversationSearchEvent): void {
    const owner = this.owners.get(requestId);
    if (!owner) return;
    if (event.type !== "hits") this.owners.delete(requestId);
    if (owner.isDestroyed()) {
      this.owners.delete(requestId);
      this.worker?.postMessage({ t: "cancel", requestId } satisfies SearchWorkerRequest);
      return;
    }
    owner.send(ConversationSearchIpc.event, event);
  }

  private broadcast(event: ConversationSearchEvent): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(ConversationSearchIpc.event, event);
    }
  }
}
