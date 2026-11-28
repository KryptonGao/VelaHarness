import type { ConversationSearchHit, ConversationSearchIndexStatus, ConversationSearchRequest } from "@vela/shared";
import type { SearchIndex, SearchRun, SearchSource } from "./search-index";

export type SearchWorkerRequest =
  | { t: "sync"; sources: SearchSource[] }
  | { t: "start"; requestId: string; request: ConversationSearchRequest }
  | { t: "cancel"; requestId: string };

export type SearchWorkerEvent =
  | { t: "status"; status: ConversationSearchIndexStatus }
  | { t: "hits"; requestId: string; hits: ConversationSearchHit[] }
  | { t: "done"; requestId: string; next: number | null }
  | { t: "error"; requestId: string | null; message: string };

const statusIntervalMs = 250;

/**
 * Runs inside the search worker process: one thread that alternates between advancing searches
 * and indexing. Every unit of work is a few milliseconds, so a new keystroke is handled between
 * two of them. Searches go first, and a search's hits are posted after each slice rather than
 * when the search ends.
 */
export class SearchWorkerCore {
  private readonly runs = new Map<string, SearchRun>();
  private postedAt = Number.NEGATIVE_INFINITY;
  private postedIndexing = false;

  constructor(
    private readonly index: SearchIndex,
    private readonly post: (event: SearchWorkerEvent) => void,
    private readonly now: () => number = () => performance.now(),
  ) {}

  handle(message: SearchWorkerRequest): void {
    try {
      if (message.t === "sync") {
        this.index.setSources(message.sources);
        this.postStatus(true);
      } else if (message.t === "start") {
        this.runs.delete(message.requestId);
        const run = this.index.search(message.request);
        if (run) this.runs.set(message.requestId, run);
        else this.post({ t: "done", requestId: message.requestId, next: null });
      } else {
        this.runs.delete(message.requestId);
      }
    } catch (error) {
      this.post({ t: "error", requestId: message.t === "sync" ? null : message.requestId, message: describe(error) });
    }
  }

  /** Do one unit of work. Returns false when there is nothing to do. */
  tick(): boolean {
    const next = this.runs.entries().next();
    if (!next.done) {
      const [requestId, run] = next.value;
      try {
        const step = run.step();
        if (step.hits.length) this.post({ t: "hits", requestId, hits: step.hits });
        if (step.done) {
          this.runs.delete(requestId);
          this.post({ t: "done", requestId, next: step.next });
        }
      } catch (error) {
        this.runs.delete(requestId);
        this.post({ t: "error", requestId, message: describe(error) });
      }
      return true;
    }
    let more: boolean;
    try {
      more = this.index.indexSlice();
    } catch (error) {
      // A file that cannot be read or stored is skipped; the rest of the queue continues.
      this.post({ t: "error", requestId: null, message: describe(error) });
      more = this.index.status().indexing;
    }
    this.postStatus(!more);
    return more;
  }

  private postStatus(force: boolean): void {
    const status = this.index.status();
    const at = this.now();
    if (!force && status.indexing === this.postedIndexing && at - this.postedAt < statusIntervalMs) return;
    this.postedAt = at;
    this.postedIndexing = status.indexing;
    this.post({ t: "status", status });
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
