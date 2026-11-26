import { syncCodexUsage } from "./codex-usage-index";

const [root, index] = process.argv.slice(2);
try {
  process.parentPort.postMessage(await syncCodexUsage(root, index));
} catch {
  process.exitCode = 1;
}

