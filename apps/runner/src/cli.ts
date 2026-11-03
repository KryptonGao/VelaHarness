import { exit, stderr, stdin, stdout } from "node:process";
import { runCli, type CliSignal } from "./main";

const code = await runCli(process.argv.slice(2), {
  stdin,
  stdout,
  stderr,
  env: process.env,
  cwd: process.cwd(),
  onSignal(listener) {
    const signals: CliSignal[] = ["SIGINT", "SIGTERM"];
    for (const signal of signals) process.on(signal, listener);
    return () => { for (const signal of signals) process.off(signal, listener); };
  },
  forceExit: (exitCode) => exit(exitCode),
});
// 依赖库可能留下计时器或句柄；任务已经收尾，直接以结果码结束。
exit(code);
