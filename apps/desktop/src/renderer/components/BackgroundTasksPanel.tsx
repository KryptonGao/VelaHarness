import type { BackgroundShellItem, BackgroundShellOutput, BackgroundShellStatus } from "@vela/shared";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useSecondClock } from "../hooks/useSecondClock";
import { tr, trf } from "../locale";
import { formatElapsed } from "./AgentPanel";
import { ChevronDownIcon, StopSquareIcon, TrashIcon } from "./icons";
import "../background-tasks.css";

export interface BackgroundTasksPanelProps {
  conversationId: string | null;
  shells: readonly BackgroundShellItem[];
}

const finishedLabels: Record<Exclude<BackgroundShellStatus, "running">, [string, string]> = {
  exited: ["已结束", "Exited"],
  failed: ["失败", "Failed"],
  killed: ["已停止", "Stopped"],
  timed_out: ["超时", "Timed out"],
};

const outputPollMs = 1000;

function statusText(shell: BackgroundShellItem): string {
  if (shell.status === "running") return tr("运行中", "Running");
  if (shell.status === "exited" && shell.exitCode !== 0) return trf("退出码 {0}", "Exit {0}", shell.exitCode ?? "?");
  return tr(...finishedLabels[shell.status]);
}

function isFailure(shell: BackgroundShellItem): boolean {
  return shell.status === "failed" || shell.status === "timed_out" || (shell.status === "exited" && shell.exitCode !== 0);
}

/** 展开时读取输出；运行中每秒刷新，结束后状态变化时再读一次。 */
function useShellOutput(conversationId: string | null, shell: BackgroundShellItem, enabled: boolean): BackgroundShellOutput | null {
  const [output, setOutput] = useState<BackgroundShellOutput | null>(null);
  const running = shell.status === "running";
  useEffect(() => {
    const api = window.vela;
    if (!enabled || !api || !conversationId) return undefined;
    let active = true;
    const load = () => {
      void api.getBackgroundShellOutput(conversationId, shell.id).then((next) => {
        if (active && next) setOutput((current) => current && current.output === next.output && current.truncated === next.truncated ? current : next);
      }).catch(() => undefined);
    };
    load();
    if (!running) return () => { active = false; };
    const timer = window.setInterval(load, outputPollMs);
    return () => { active = false; window.clearInterval(timer); };
  }, [enabled, conversationId, shell.id, running, shell.status]);
  return output;
}

function ShellOutput({ shell, output }: { shell: BackgroundShellItem; output: BackgroundShellOutput | null }) {
  const ref = useRef<HTMLPreElement>(null);
  const stick = useRef(true);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [output?.output]);
  return (
    <pre
      ref={ref}
      className="bg-task-output"
      tabIndex={0}
      onScroll={(event) => {
        const el = event.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      }}
    >
      <span className="bg-task-prompt">$ {shell.command}</span>
      {output?.truncated ? `\n${tr("…（前面的输出已省略）", "… (earlier output omitted)")}` : ""}
      {output?.output ? `\n${output.output.replace(/\n$/, "")}` : ""}
    </pre>
  );
}

function ShellTask({ conversationId, shell, now }: { conversationId: string | null; shell: BackgroundShellItem; now: number }) {
  const running = shell.status === "running";
  const [open, setOpen] = useState(running);
  const [stopping, setStopping] = useState(false);
  const output = useShellOutput(conversationId, shell, open);
  const elapsed = formatElapsed((shell.endedAt ?? now) - shell.startedAt);

  const stop = useCallback(async () => {
    if (!conversationId || !window.vela) return;
    setStopping(true);
    try { await window.vela.killBackgroundShell(conversationId, shell.id); }
    catch { /* 命令恰好已经结束时会被拒绝，以随后的状态事件为准。 */ }
    finally { setStopping(false); }
  }, [conversationId, shell.id]);

  return (
    <div className="bg-task" data-status={shell.status}>
      <div className="bg-task-head">
        <button type="button" className="bg-task-toggle" aria-expanded={open} title={shell.command} onClick={() => setOpen((value) => !value)}>
          <span className="bg-task-chevron" data-open={open ? "true" : undefined}><ChevronDownIcon size={11} /></span>
          <span className="bg-task-command">{shell.command}</span>
        </button>
        {!running ? <span className={`bg-task-status${isFailure(shell) ? " is-failed" : ""}`}>{statusText(shell)}</span> : null}
        <span className="bg-task-time">{elapsed}</span>
        {running ? (
          <button type="button" className="bg-task-stop" disabled={stopping} title={tr("停止", "Stop")} aria-label={tr("停止后台任务", "Stop background task")} onClick={() => void stop()}>
            <StopSquareIcon size={11} />
          </button>
        ) : null}
      </div>
      {open ? <ShellOutput shell={shell} output={output} /> : null}
    </div>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="bg-section">
      <button type="button" className="bg-section-head" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className="bg-task-chevron" data-open={open ? "true" : undefined}><ChevronDownIcon size={11} /></span>
        <span>{title}</span>
        <span className="bg-section-count">{count}</span>
      </button>
      {open ? <div className="bg-section-body">{children}</div> : null}
    </section>
  );
}

/** 右侧面板里的「后台任务」标签页：运行中与已结束的后台命令，展开可看输出。 */
export function BackgroundTasksPanel({ conversationId, shells }: BackgroundTasksPanelProps) {
  const running = shells.filter((shell) => shell.status === "running");
  const finished = shells.filter((shell) => shell.status !== "running").sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0));
  const now = useSecondClock(running.length > 0);

  const clear = useCallback(() => {
    if (conversationId) void window.vela?.clearFinishedBackgroundShells(conversationId).catch(() => undefined);
  }, [conversationId]);

  return (
    <div className="bg-tasks">
      <div className="bg-tasks-bar">
        <span className="bg-tasks-title">{tr("后台任务", "Background tasks")}</span>
        <button type="button" className="bg-tasks-clear" disabled={finished.length === 0} title={tr("清除已结束的任务", "Clear finished tasks")}
          aria-label={tr("清除已结束的任务", "Clear finished tasks")} onClick={clear}>
          <TrashIcon size={14} />
        </button>
      </div>
      {shells.length === 0 ? <p className="bg-tasks-empty">{tr("暂无后台任务", "No background tasks")}</p> : null}
      {running.length > 0 ? (
        <Section title={tr("运行中", "Running")} count={running.length}>
          {running.map((shell) => <ShellTask key={shell.id} conversationId={conversationId} shell={shell} now={now} />)}
        </Section>
      ) : null}
      {finished.length > 0 ? (
        <Section title={tr("已结束", "Finished")} count={finished.length}>
          {finished.map((shell) => <ShellTask key={shell.id} conversationId={conversationId} shell={shell} now={now} />)}
        </Section>
      ) : null}
    </div>
  );
}
