import type { ToolActivity, ToolTrace } from "@vela/shared";
import { isAgentToolName } from "@vela/shared";
import type { ReactNode } from "react";
import { tr, trf } from "../locale";
import { AgentAvatar } from "./AgentAvatar";
import { agentKindLabel, findAgentInfo, useAgentRoster } from "./AgentPanel";
import { FileTypeIcon } from "./FileTypeIcon";
import { ArrowRightIcon, EditFileIcon, FilePlusIcon, FolderIcon, GlobeIcon, McpIcon, ReadFileIcon, SearchIcon, SkillIcon, TerminalIcon, ToolIcon, WebFetchIcon, WebSearchIcon } from "./icons";
import { bashIntentDisplay } from "./bash-intent-label";
import { summarizeBrowserCode, type BrowserStep } from "./browser-call";
import { isSkillRead, skillNameOf, splitPath } from "./tool-compact";
import { isMcpDiscoveryTool, splitMcpQuery } from "./tool-result-model";
import { toolNameIcon } from "./tool-name-icon";

export type ToolKind = "browser" | "bash" | "read" | "edit" | "write" | "other";

export function toolKind(name: string): ToolKind {
  if (name === "browser_repl" || name === "browser_repl_reset") return "browser";
  if (name === "bash" || name === "read" || name === "edit" || name === "write") return name;
  return "other";
}

export function KindIcon({ kind, command, skill = false }: { kind: ToolKind; command?: string; skill?: boolean }): ReactNode {
  if (skill) return <SkillIcon size={13} />;
  if (kind === "other") return <ToolIcon size={13} />;
  if (kind === "bash") {
    const intent = bashIntentDisplay(command)?.kind;
    if (intent === "list") return <FolderIcon size={13} />;
    if (intent === "read") return <ReadFileIcon size={13} />;
    if (intent === "search" || intent === "find") return <SearchIcon size={13} />;
    return <TerminalIcon size={13} />;
  }
  if (kind === "read") return <ReadFileIcon size={13} />;
  if (kind === "edit") return <EditFileIcon size={13} />;
  if (kind === "write") return <FilePlusIcon size={13} />;
  return <TerminalIcon size={13} />;
}

function toolActionName(name: string): string | null {
  if (name === "create_scheduled_task") return tr("创建", "Create");
  if (name === "list_scheduled_tasks") return tr("查询", "List");
  if (name === "update_scheduled_task") return tr("修改", "Update");
  if (name === "delete_scheduled_task") return tr("删除", "Delete");
  if (name === "memory_read") return tr("读取", "Read");
  if (name === "memory_update") return tr("更新", "Update");
  return null;
}

export function todoFocus(plan: ToolActivity["plan"]): NonNullable<ToolActivity["plan"]>[number] | null {
  if (!plan?.length) return null;
  return (
    plan.find((item) => item.status === "in_progress") ??
    plan.find((item) => item.status === "pending") ??
    plan[plan.length - 1]!
  );
}

export function subjectOf(kind: ToolKind, activity: ToolActivity, name: string): { name: string; dir: string } {
  const presentation = activity.presentation;
  if (presentation?.kind === "shell") return { name: presentation.shell.command || presentation.shell.id, dir: "" };
  if (presentation?.kind === "discovery" && presentation.query) return { name: splitMcpQuery(presentation.query).text, dir: "" };
  if (presentation?.kind === "resource") return { name: presentation.uri || presentation.server || name, dir: "" };
  if (presentation?.kind === "schedule" && presentation.tasks.length === 1) {
    const task = presentation.tasks[0];
    if (task && typeof task === "object" && !Array.isArray(task) && typeof task.title === "string") return { name: task.title, dir: "" };
  }
  if (kind === "bash") {
    const intent = bashIntentDisplay(activity.command);
    if (intent) return { name: intent.name, dir: intent.dir };
    const command = activity.command?.replace(/\s+/g, " ").trim();
    return { name: command || tr("命令", "Command"), dir: "" };
  }
  const path = activity.path?.trim();
  if (!path) {
    if (name === "update_plan" && activity.plan?.length) {
      return { name: activity.plan[0]!.text, dir: "" };
    }
    if (name === "update_todos" && activity.plan?.length) {
      return { name: todoFocus(activity.plan)!.text, dir: "" };
    }
    if (
      name === "submit_plan" ||
      name === "update_plan" ||
      name === "record_goal_validation" ||
      name === "update_goal" ||
      name === "complete_step" ||
      name === "submit_outcome" ||
      name === "recommend_actions"
    ) {
      const line = activity.body?.split("\n").find((item) => item.trim())?.trim();
      return { name: line || name, dir: "" };
    }
    return { name: toolActionName(name) ?? name, dir: "" };
  }
  const normalized = path.replaceAll("\\", "/");
  const index = normalized.lastIndexOf("/");
  if (index <= 0) return { name: path, dir: "" };
  return splitPath(path);
}

export function subjectIsCode(kind: ToolKind, activity: ToolActivity): boolean {
  if (activity.presentation?.kind === "shell") return true;
  if (kind !== "bash") return false;
  const intent = bashIntentDisplay(activity.command);
  return !intent || intent.kind === "script" || intent.kind === "search";
}

/** Static subject shared by the compact command row and the thinking headline. */
export function BashSubject({ activity }: { activity: ToolActivity }) {
  const subject = subjectOf("bash", activity, "bash");
  return <>
    <span className={`tool-compact-cmd${subjectIsCode("bash", activity) ? "" : " is-plain"}`}>{subject.name}</span>
    {subject.dir ? <span className="tool-compact-dir">{subject.dir}</span> : null}
  </>;
}

export function browserStepLabel(step: BrowserStep): string {
  switch (step.kind) {
    case "open": return step.target ? trf("打开 {0}", "Open {0}", step.target) : tr("打开页面", "Open page");
    case "screenshot": return tr("截图", "Screenshot");
    case "click": return step.target ? trf("点击「{0}」", "Click “{0}”", step.target) : tr("点击", "Click");
    case "input": return tr("输入文字", "Type text");
    case "snapshot": return tr("读取页面", "Read page");
    case "inspect": return tr("检查页面", "Inspect page");
    case "connect": return tr("连接浏览器", "Connect browser");
    default: return tr("运行脚本", "Run script");
  }
}

/** Static browser steps shared by the browser tool and the thinking headline. */
export function BrowserHeadlineSteps({ steps }: { steps: readonly BrowserStep[] }) {
  return <span className="browser-call-steps">
    {steps.map((step, index) => (
      <span className="browser-call-step-wrap" key={index}>
        {index > 0 ? <ArrowRightIcon size={10} /> : null}
        <span className={`browser-call-step is-${step.kind}`}>{browserStepLabel(step)}</span>
      </span>
    ))}
  </span>;
}

export function taskTitle(body: string | undefined): string {
  const line = body?.split("\n").find((item) => item.trim())?.replace(/\s+/g, " ").trim();
  return line || tr("子代理", "Subagent");
}

export function AgentHeadlineIcon({ avatarId, name }: { avatarId?: string | null; name: string }) {
  return avatarId ? <AgentAvatar agentId={avatarId} size={18} /> : toolNameIcon(name) ?? <ToolIcon size={13} />;
}

/** Presentation only: no buttons, status indicators, durations or diff statistics. */
export function ToolHeadlineIcon({ tool }: { tool: ToolTrace }) {
  const roster = useAgentRoster();
  const activity = tool.activity ?? {};
  if (activity.mcp || isMcpDiscoveryTool(tool.name)) return <McpIcon size={13} />;
  if (isAgentToolName(tool.name)) {
    const live = findAgentInfo(roster, activity.agentId, activity.agentPath);
    return <AgentHeadlineIcon name={tool.name} avatarId={live?.id ?? activity.agentId ?? activity.agentPath} />;
  }
  if (toolKind(tool.name) === "browser") return <GlobeIcon size={13} />;
  if (tool.name === "web_fetch") return <WebFetchIcon size={13} />;
  if (tool.name === "web_search") return <WebSearchIcon size={13} />;
  return toolNameIcon(tool.name) ?? <KindIcon kind={toolKind(tool.name)} command={activity.command} skill={isSkillRead(tool)} />;
}

/** Inline, non-interactive details for a parent-owned headline button. */
export function ToolHeadlineDetails({ tool }: { tool: ToolTrace }) {
  const roster = useAgentRoster();
  const activity = tool.activity ?? {};
  const kind = toolKind(tool.name);
  if (activity.mcp) return <>
    <span className="tool-card-name grow">{activity.mcp.tool}</span>
    <span className="tool-mcp-source">{activity.mcp.server}</span>
  </>;
  if (isAgentToolName(tool.name)) {
    const live = findAgentInfo(roster, activity.agentId, activity.agentPath);
    return <>
      <span className="tool-compact-action">{agentKindLabel(live?.kind ?? activity.agent)}</span>
      <span className="agent-compact-name">{live?.path ?? activity.agentPath ?? taskTitle(activity.body)}</span>
    </>;
  }
  if (kind === "browser") return <BrowserHeadlineSteps steps={summarizeBrowserCode(activity.command)} />;
  if (kind === "bash") return <BashSubject activity={activity} />;
  const skillName = isSkillRead(tool) ? skillNameOf(tool) : "";
  const subject = subjectOf(kind, activity, tool.name);
  if (kind === "read" || kind === "edit" || kind === "write") return <>
    <FileTypeIcon path={activity.path?.trim() || subject.name} />
    <span className="tool-compact-name is-static">{skillName || subject.name}</span>
    {!skillName && subject.dir ? <span className="tool-compact-dir">{subject.dir}</span> : null}
  </>;
  return <>
    <span className={`tool-card-name${subject.dir ? "" : " grow"}${subjectIsCode(kind, activity) ? " is-code" : ""}`}>{subject.name}</span>
    {subject.dir ? <span className="tool-card-dir">{subject.dir}</span> : null}
  </>;
}
