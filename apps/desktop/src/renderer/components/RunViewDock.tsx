import { useEffect, useState } from "react";
import type { ToolPlanItem } from "@vela/shared";
import { tr } from "../locale";
import type { UiMessage } from "../hooks/useSession";
import {
  advanceRunStep,
  currentTurnAssistants,
  currentTurnStartedAt,
  formatRunElapsed,
  initialRunStepDisplay,
  latestTodos,
  orbActivityOf,
  runStepSignal,
  sameRunStepDisplay,
  type RunStepDisplay,
  type RunStepKind,
} from "../run-view";
import { ActivityIndicator } from "./ActivityIndicator";
import { CheckIcon } from "./icons";

function stepLabel(kind: RunStepKind): string {
  switch (kind) {
    case "thinking": return tr("思考中", "Thinking");
    case "writing": return tr("撰写回复", "Writing");
    case "command": return tr("运行命令", "Running Command");
    case "reading": return tr("读取文件", "Reading Files");
    case "editing": return tr("编辑文件", "Editing Files");
    case "searching": return tr("搜索网页", "Searching the Web");
    case "subagent": return tr("运行子代理", "Running Subagent");
    case "todos": return tr("更新待办", "Updating Todos");
    case "working": return tr("正在执行", "Working");
  }
}

/** 待办清单:圆角卡片,待办是虚线圈、进行中转圈、完成是实心勾。点右上角的计数折叠到只剩当前项。 */
function RunTodoCard({ items }: { items: ToolPlanItem[] }) {
  const [open, setOpen] = useState(true);
  const done = items.filter((item) => item.status === "completed").length;
  const shown = open ? items : items.filter((item) => item.status === "in_progress");
  return (
    <section className="run-todo" aria-label={tr("待办清单", "Todo list")}>
      <button
        type="button"
        className="run-todo-count"
        aria-expanded={open}
        title={open ? tr("折叠待办", "Collapse todos") : tr("展开待办", "Expand todos")}
        onClick={() => setOpen((current) => !current)}
      >{done} / {items.length}</button>
      <ul className="run-todo-list">
        {shown.map((item, index) => (
          <li key={`${index}:${item.text}`} data-status={item.status}>
            <span className="run-todo-mark" aria-hidden="true">
              {item.status === "completed" ? <CheckIcon size={9} /> : null}
            </span>
            <span className="run-todo-text">{item.text}</span>
            <span className="sr-only">{item.status === "completed" ? tr("已完成", "Completed") : item.status === "in_progress" ? tr("进行中", "In progress") : tr("待办", "Pending")}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 本轮用时:自己每秒刷新,不带动状态条里的动画重新渲染。 */
function RunElapsed({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  return <span className="run-status-time" aria-hidden="true">{formatRunElapsed(now - startedAt)}</span>;
}

/**
 * 状态条:左边是运行动画,右边是当前步骤类型和用时。
 * 命令要跑过冷却才显示「运行命令」,几十毫秒就结束的命令不会让标签闪一下。
 */
function RunStatusBar({ messages }: { messages: UiMessage[] }) {
  const startedAt = currentTurnStartedAt(messages);
  const assistants = currentTurnAssistants(messages);
  const step = runStepSignal(assistants[assistants.length - 1]);
  const stepKind = step.kind;
  const stepKey = step.key;
  const [display, setDisplay] = useState<RunStepDisplay>(() => initialRunStepDisplay(step, Date.now()));
  const [tick, setTick] = useState(0);

  // 步骤变了(含流式更新)就推进一次:普通步骤立即换,命令先挂起等冷却。
  useEffect(() => {
    setDisplay((current) => {
      const next = advanceRunStep(current, { kind: stepKind, key: stepKey }, Date.now());
      return sameRunStepDisplay(next, current) ? current : next;
    });
  }, [stepKind, stepKey, tick]);

  // 冷却到点后再推进一次,把撑过冷却的命令显示出来。
  const deadline = display.pending?.deadline;
  useEffect(() => {
    if (deadline === undefined) return undefined;
    const timer = window.setTimeout(() => setTick((value) => value + 1), Math.max(0, deadline - Date.now()));
    return () => window.clearTimeout(timer);
  }, [deadline, tick]);

  const label = stepLabel(display.kind);
  return (
    <div className="run-status">
      <div className="run-status-row">
        <ActivityIndicator label={label} activity={orbActivityOf(display.kind)} />
        <span className="run-status-label">{label}</span>
        {startedAt !== undefined ? <RunElapsed startedAt={startedAt} /> : null}
      </div>
    </div>
  );
}

/**
 * 运行视图:本轮运行中紧跟在过程之后、随对话滚动的待办清单和状态条。
 * 模型步骤仍是上方对话里原有的消息与工具行,这里不重复渲染。
 */
export function RunViewDock({ messages }: { messages: UiMessage[] }) {
  const todos = latestTodos(messages);
  return (
    <div className="run-dock" aria-label={tr("运行状态", "Run status")}>
      {todos ? <RunTodoCard items={todos} /> : null}
      <RunStatusBar messages={messages} />
    </div>
  );
}
