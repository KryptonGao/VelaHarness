import { useState, type ReactNode } from "react";
import { isAgentBusy, type AgentInfo, type AgentStatus, type AppState } from "@vela/shared";
import type { ProjectApi } from "../../hooks/useProject";
import { useDismissable } from "../../hooks/useDismissable";
import type { UiMessage } from "../../hooks/useSession";
import { planReferenceModel, type PlanDraft } from "../../plan-draft";
import { fileManagerName } from "../../platform";
import { localizeError, tr, trf } from "../../locale";
import { BranchPickerContent } from "../composer/BranchChip";
import { ContextUsageCard, GoalCardBody, goalStatusLabel } from "../ContextPanel";
import { FileTypeIcon } from "../FileTypeIcon";
import { AgentAvatar } from "../AgentAvatar";
import { PopoverPresence } from "../MotionPresence";
import { RepoCardPopover } from "../RepoCardPopover";
import { planStatusLabel } from "../PlanPanel";
import {
  BranchIcon, DiffIcon, FolderIcon, GithubIcon, GoalIcon, PlanIcon, StackIcon, SubagentIcon, ToolIcon, ViewGaugeIcon,
} from "../icons";
import type { InfoCardId } from "./info-cards-layout";
import type { OutputFile } from "./info-cards-data";

/** 信息卡片需要的全部输入；由 ChatView 提供，卡片自己不订阅会话。 */
export interface InfoCardContext {
  state: AppState | null;
  project: ProjectApi;
  messages: readonly UiMessage[];
  /** 本对话 write 工具写出的文件，由栈按 messages 缓存。 */
  outputs: readonly OutputFile[];
  planDraft: PlanDraft | null;
  agents: readonly AgentInfo[];
  changesActive: boolean;
  onOpenChanges: () => void;
  onOpenPlan?: (planId: string) => void;
  onResumeGoal?: () => void;
  onOpenAgent: (agentId: string) => void;
  onOpenFile: (path: string) => void;
}

export interface InfoCardDefinition {
  Icon: (props: { size?: number }) => ReactNode;
  title: () => string;
  /** 数据上是否有内容；没有时卡片不渲染，也不占排序位置。 */
  available: (ctx: InfoCardContext) => boolean;
  /** 折叠后标题行右侧的一行摘要。 */
  summary: (ctx: InfoCardContext) => ReactNode;
  Body: (props: { ctx: InfoCardContext }) => ReactNode;
}

const subagentsOf = (ctx: InfoCardContext) => ctx.agents.filter((agent) => agent.kind !== "root");

const agentStatusLabels: Record<AgentStatus, [string, string]> = {
  idle: ["空闲", "Idle"],
  running: ["运行中", "Running"],
  paused: ["已暂停", "Paused"],
  completed: ["已完成", "Completed"],
  failed: ["失败", "Failed"],
  aborted: ["已中止", "Aborted"],
};

function planModel(ctx: InfoCardContext) {
  const session = ctx.state?.session;
  return planReferenceModel(session?.proposedPlan ?? null, ctx.planDraft, session?.executionPlan ?? null);
}

// ---------- 环境 ----------

function EnvironmentBody({ ctx }: { ctx: InfoCardContext }) {
  const { project } = ctx;
  const [branchOpen, setBranchOpen] = useState(false);
  const branchRef = useDismissable<HTMLDivElement>(branchOpen, () => setBranchOpen(false));
  const git = project.git;
  const repo = git?.repo ?? null;
  const workspace = project.workspace?.current ?? null;
  const root = repo?.root ?? workspace;
  const name = repo?.name ?? workspace?.split("/").filter(Boolean).pop() ?? tr("工作区", "Workspace");
  const pr = project.pr?.pr ?? null;

  return (
    <div className="info-card-rows">
      <button type="button" className="info-card-row" disabled={!root} title={root ?? undefined}
        aria-label={`${tr("在", "Open in ")}${fileManagerName(window.vela?.platform ?? "darwin")}${tr("中打开", "")}: ${name}`}
        onClick={() => root && void project.openFile(root)}>
        <FolderIcon />
        <span className="info-card-row-main">{name}</span>
        {root ? <span className="info-card-row-note">{root.replace(/^\/Users\/[^/]+/, "~")}</span> : null}
      </button>
      {repo && git ? (
        <div className="info-card-branch" ref={branchRef}>
          <button type="button" className="info-card-row" aria-haspopup="true" aria-expanded={branchOpen}
            title={tr("切换分支", "Switch branch")} onClick={() => setBranchOpen((open) => !open)}>
            <BranchIcon />
            <span className="info-card-row-main">{git.branch ?? "HEAD"}</span>
          </button>
          <PopoverPresence present={branchOpen}>
            <RepoCardPopover anchor={branchRef} className="repo-branch-popover" label={tr("切换分支", "Switch branch")}>
              <BranchPickerContent project={project} onClose={() => setBranchOpen(false)} />
            </RepoCardPopover>
          </PopoverPresence>
        </div>
      ) : (
        <p className="info-card-empty">
          {workspace ? tr("未检测到 Git 仓库", "No Git repository detected") : tr("尚未选择工作区", "No workspace selected")}
        </p>
      )}
      {repo ? (
        pr ? (
          <button type="button" className="info-card-row" onClick={() => void project.openPullRequest(pr.url)}>
            <GithubIcon />
            <span className="info-card-row-main">#{pr.number} {pr.title}</span>
          </button>
        ) : project.pr?.ghAvailable ? (
          <button type="button" className="info-card-row" onClick={() => void project.createPullRequest()}>
            <GithubIcon />
            <span className="info-card-row-main">{tr("创建 Pull Request", "Create pull request")}</span>
          </button>
        ) : project.pr?.reason ? <p className="info-card-empty">{localizeError(project.pr.reason)}</p> : null
      ) : null}
    </div>
  );
}

// ---------- 目标 ----------

function GoalBody({ ctx }: { ctx: InfoCardContext }) {
  const goal = ctx.state?.session.goal;
  if (!goal) return null;
  return <GoalCardBody goal={goal} busy={ctx.state?.session.status !== "ready"} onResume={() => ctx.onResumeGoal?.()} />;
}

// ---------- 计划 ----------

function PlanBody({ ctx }: { ctx: InfoCardContext }) {
  const model = planModel(ctx);
  return (
    <div className="info-card-rows">
      {model && ctx.onOpenPlan ? (
        <button type="button" className="info-card-row" onClick={() => ctx.onOpenPlan?.(model.id)}
          aria-label={`${tr("打开计划", "Open plan")}: ${model.title || tr("未命名计划", "Untitled plan")}`}>
          <PlanIcon size={15} />
          <span className="info-card-row-main">{model.title || tr("未命名计划", "Untitled plan")}</span>
          <span className="info-card-row-note">{model.streaming ? tr("生成中", "Writing") : planStatusLabel(model.status)}</span>
        </button>
      ) : null}
    </div>
  );
}

// ---------- 上下文 ----------

function ContextBody({ ctx }: { ctx: InfoCardContext }) {
  return <div className="info-card-context"><ContextUsageCard context={ctx.state?.context} details /></div>;
}

function ContextSummary({ ctx }: { ctx: InfoCardContext }) {
  const percent = ctx.state?.context.percent;
  if (percent === null || percent === undefined) return null;
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <>
      <span>{Math.round(percent)}%</span>
      <span className={`info-card-mini${percent >= 80 ? " high" : ""}`} aria-hidden="true"><i style={{ width: `${clamped}%` }} /></span>
    </>
  );
}

// ---------- 产出 ----------

function OutputsBody({ ctx }: { ctx: InfoCardContext }) {
  const files = ctx.outputs;
  return (
    <div className="info-card-rows">
      {files.map((file) => (
        <button key={file.path} type="button" className="info-card-row" title={file.path} onClick={() => ctx.onOpenFile(file.path)}>
          <span className="info-card-file-icon"><FileTypeIcon path={file.path} /></span>
          <span className="info-card-row-main">{file.name}</span>
        </button>
      ))}
    </div>
  );
}

// ---------- 变更 ----------

function ChangesBody({ ctx }: { ctx: InfoCardContext }) {
  const { project } = ctx;
  const git = project.git;
  if (!git?.repo) return null;
  const pr = project.pr?.pr ?? null;
  const files = git.files;
  return (
    <div className="info-card-rows">
      <div className="info-card-stat">
        {files.length > 0 ? (
          <button
            type="button"
            className={`info-card-stat-link${ctx.changesActive ? " is-active" : ""}`}
            title={tr("在右侧面板查看变更", "View changes in the side panel")}
            onClick={ctx.onOpenChanges}
          >
            <span className="info-card-added">+{git.addedLines.toLocaleString("en-US")}</span>
            <span className="info-card-deleted">−{git.deletedLines.toLocaleString("en-US")}</span>
            <span className="info-card-row-note">{trf("{0} 个文件", "{0} files", files.length)}</span>
          </button>
        ) : <span className="info-card-row-note">{tr("工作区无变更", "Workspace is clean")}</span>}
        <span className="info-card-spacer" />
        {pr ? (
          <button type="button" className="info-card-pill" onClick={() => void project.openPullRequest(pr.url)}>{tr("打开 PR", "Open PR")}</button>
        ) : project.pr?.ghAvailable ? (
          <button type="button" className="info-card-pill" onClick={() => void project.createPullRequest()}>{tr("创建 PR", "Create PR")}</button>
        ) : null}
      </div>
    </div>
  );
}

// ---------- 子代理 ----------

function AgentsBody({ ctx }: { ctx: InfoCardContext }) {
  return (
    <div className="info-card-rows">
      {subagentsOf(ctx).map((agent) => (
        <button key={agent.id} type="button" className="info-card-row" title={agent.task || agent.path} onClick={() => ctx.onOpenAgent(agent.id)}>
          <AgentAvatar agentId={agent.id} />
          <span className="info-card-row-main">{agent.name}</span>
          {isAgentBusy(agent.status) ? <span className="info-card-spin" aria-hidden="true" /> : null}
          <span className={`info-card-chip is-${agent.status}`}>{tr(...agentStatusLabels[agent.status])}</span>
        </button>
      ))}
    </div>
  );
}

// ---------- 已启用工具 ----------

function ToolsBody({ ctx }: { ctx: InfoCardContext }) {
  return (
    <ul className="info-card-chips">
      {(ctx.state?.session.tools ?? []).map((tool) => <li key={tool}>{tool}</li>)}
    </ul>
  );
}

export const infoCardDefinitions: Record<InfoCardId, InfoCardDefinition> = {
  env: {
    Icon: ({ size }) => <FolderIcon size={size} />,
    title: () => tr("环境", "Environment"),
    available: () => true,
    summary: (ctx) => ctx.project.git?.branch ?? ctx.project.workspace?.current?.split("/").filter(Boolean).pop() ?? null,
    Body: EnvironmentBody,
  },
  goal: {
    Icon: ({ size }) => <GoalIcon size={size} />,
    title: () => tr("目标", "Goal"),
    available: (ctx) => Boolean(ctx.state?.session.goal),
    summary: (ctx) => {
      const status = ctx.state?.session.goal?.status;
      return status ? <span className={`info-card-chip is-goal-${status}`}>{goalStatusLabel(status)}</span> : null;
    },
    Body: GoalBody,
  },
  plan: {
    Icon: ({ size }) => <PlanIcon size={size} />,
    title: () => tr("计划", "Plan"),
    available: (ctx) => planModel(ctx) !== null,
    summary: (ctx) => {
      const model = planModel(ctx);
      return model ? (model.streaming ? tr("生成中", "Writing") : planStatusLabel(model.status)) : null;
    },
    Body: PlanBody,
  },
  context: {
    Icon: ({ size }) => <ViewGaugeIcon size={size} />,
    title: () => tr("上下文", "Context"),
    available: (ctx) => ctx.state !== null,
    summary: (ctx) => <ContextSummary ctx={ctx} />,
    Body: ContextBody,
  },
  outputs: {
    Icon: ({ size }) => <StackIcon size={size} />,
    title: () => tr("产出", "Outputs"),
    available: (ctx) => ctx.outputs.length > 0,
    summary: (ctx) => trf("{0} 个文件", "{0} files", ctx.outputs.length),
    Body: OutputsBody,
  },
  changes: {
    Icon: ({ size }) => <DiffIcon size={size} />,
    title: () => tr("变更", "Changes"),
    available: (ctx) => Boolean(ctx.project.git?.repo),
    summary: (ctx) => {
      const git = ctx.project.git;
      if (!git?.repo) return null;
      if (git.files.length === 0) return tr("无变更", "No changes");
      return (
        <>
          <span className="info-card-added">+{git.addedLines.toLocaleString("en-US")}</span>
          <span className="info-card-deleted">−{git.deletedLines.toLocaleString("en-US")}</span>
        </>
      );
    },
    Body: ChangesBody,
  },
  agents: {
    Icon: ({ size }) => <SubagentIcon size={size} />,
    title: () => tr("子代理", "Subagents"),
    available: (ctx) => subagentsOf(ctx).length > 0,
    summary: (ctx) => {
      const agents = subagentsOf(ctx);
      const running = agents.filter((agent) => isAgentBusy(agent.status)).length;
      return running > 0 ? trf("{0} 运行中", "{0} running", running) : String(agents.length);
    },
    Body: AgentsBody,
  },
  tools: {
    Icon: ({ size }) => <ToolIcon size={size} />,
    title: () => tr("已启用工具", "Enabled tools"),
    available: (ctx) => (ctx.state?.session.tools?.length ?? 0) > 0,
    summary: (ctx) => String(ctx.state?.session.tools?.length ?? 0),
    Body: ToolsBody,
  },
};
