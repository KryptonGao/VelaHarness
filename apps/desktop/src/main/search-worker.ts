import { setPriority } from "node:os";
import { SearchIndex } from "./search-index";
import { SearchWorkerCore, type SearchWorkerRequest } from "./search-service";

/** Utility process entry: owns the search database so indexing never blocks the main process. */
const [indexPath] = process.argv.slice(2);
const port = process.parentPort;
if (!indexPath || !port) process.exit(1);

// Building the index is background work; it should not compete with the app for the CPU.
try { setPriority(10); } catch { /* keep the default priority */ }

let core: SearchWorkerCore;
try {
  core = new SearchWorkerCore(SearchIndex.open(indexPath), event => port.postMessage(event));
} catch (error) {
  port.postMessage({ t: "error", requestId: null, message: error instanceof Error ? error.message : String(error) });
  process.exit(1);
}

let scheduled = false;
const run = () => {
  scheduled = false;
  if (core.tick()) schedule();
};
// setImmediate lets queued messages (a new keystroke, a cancel) run between two units of work.
const schedule = () => {
  if (scheduled) return;
  scheduled = true;
  setImmediate(run);
};

port.on("message", event => {
  core.handle(event.data as SearchWorkerRequest);
  schedule();
});
