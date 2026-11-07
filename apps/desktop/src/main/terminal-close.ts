import type { TerminalCloseStatus } from "@vela/shared";
import { execFile } from "node:child_process";
import { basename } from "node:path";
import { promisify } from "node:util";

const runFile = promisify(execFile);

/** Inspect both child jobs (including background jobs) and an exec-replaced shell. */
export function terminalHasRunningCommand(pid: number, shell: string, table: string): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0 || !shell) throw new Error("Invalid terminal process");
  const rows = table.trim().split(/\r?\n/).filter(Boolean).map(line => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.+?)\s*$/.exec(line);
    if (!match) throw new Error("Invalid process table");
    return { pid: Number(match[1]), parent: Number(match[2]), state: match[3]!, command: match[4]! };
  });
  if (!rows.length) throw new Error("Empty process table");
  const root = rows.find(row => row.pid === pid);
  if (!root || root.state.startsWith("Z")) return false;
  if (rows.some(row => row.parent === pid && !row.state.startsWith("Z"))) return true;
  return basename(root.command).replace(/^-/, "") !== basename(shell);
}

export async function probeTerminalCommand(pid: number, shell: string): Promise<boolean> {
  // Unsupported platforms or a failed/partial ps result deliberately fall back to confirmation.
  if (process.platform === "win32") throw new Error("Process inspection unavailable");
  const { stdout } = await runFile("/bin/ps", ["-A", "-o", "pid=,ppid=,stat=,comm="], {
    timeout: 2000,
    maxBuffer: 4 * 1024 * 1024,
    encoding: "utf8",
  });
  return terminalHasRunningCommand(pid, shell, stdout);
}

interface CloseSession {
  owner: number;
}

interface CloseDependencies<Session extends CloseSession> {
  getSession: (id: string) => Session | undefined;
  probe: (session: Session) => Promise<boolean>;
}

/** Owner checks and deduplication are independent of Electron and session teardown. */
export class TerminalCloseCheck<Session extends CloseSession> {
  private readonly pending = new WeakMap<Session, Promise<TerminalCloseStatus>>();

  constructor(private readonly dependencies: CloseDependencies<Session>) {}

  request(id: string, owner: number): Promise<TerminalCloseStatus> {
    const session = this.dependencies.getSession(id);
    if (!session) return Promise.resolve("idle");
    if (session.owner !== owner) return Promise.resolve("unavailable");
    const pending = this.pending.get(session);
    if (pending) return pending;
    const result = this.check(id, owner, session).finally(() => this.pending.delete(session));
    this.pending.set(session, result);
    return result;
  }

  private async check(id: string, owner: number, session: Session): Promise<TerminalCloseStatus> {
    let busy = true;
    try {
      busy = await this.dependencies.probe(session);
    } catch {
      // A probe failure is not evidence that the terminal is idle.
    }
    const current = this.dependencies.getSession(id);
    if (!current) return "idle";
    if (current !== session || current.owner !== owner) return "unavailable";
    return busy ? "busy" : "idle";
  }
}
