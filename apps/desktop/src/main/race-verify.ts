import { spawn } from "node:child_process";
import { raceLimits, redactSensitive } from "@vela/shared";

export interface VerifyResult {
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  outputTail: string;
}

export const verifyTimeoutMs = 10 * 60_000;
const keepBytes = 64 * 1024;

/**
 * 在赛道 worktree 里跑统一验证指令。命令来自使用者在赛马设置里写的那一行，
 * cwd 由主程序按赛道记录决定，不接受 renderer 传入路径。超时杀整个进程组。
 */
export function runVerifyCommand(command: string, cwd: string, timeoutMs = verifyTimeoutMs): Promise<VerifyResult> {
  return new Promise(resolve => {
    const started = Date.now();
    let output = "";
    let timedOut = false;
    let settled = false;
    const child = spawn("/bin/sh", ["-c", command], {
      cwd,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CI: "1", FORCE_COLOR: "0", NO_COLOR: "1" },
    });
    const collect = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.length > keepBytes * 2) output = output.slice(-keepBytes);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const killGroup = () => {
      try { if (child.pid) process.kill(-child.pid, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch { /* 已退出 */ } }
    };
    const timer = setTimeout(() => { timedOut = true; killGroup(); }, timeoutMs);
    const finish = (exitCode: number | null, extra = "") => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const tail = redactSensitive(`${output}${extra}`.slice(-raceLimits.outputTail)) as string;
      resolve({ exitCode, timedOut, durationMs: Date.now() - started, outputTail: tail });
    };
    child.on("error", error => finish(null, `\n${error.message}`));
    child.on("close", code => finish(code));
  });
}
