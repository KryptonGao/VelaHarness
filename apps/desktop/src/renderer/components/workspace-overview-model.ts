import type { ConversationSummary, GitFileStatus, ScheduledTask, WorkspaceOverviewGit } from "@vela/shared";
import { activityDay, activityReason, type ActivityOptions, type ActivityReason } from "./conversation-activity";
import { groupActiveConversations } from "./conversation-search";

export const overviewActivityDays = 14;

/** 属于这个工作区、会显示在侧边栏里的对话(与侧边栏分组口径一致)。 */
export function workspaceConversations(all: readonly ConversationSummary[], cwd: string, untitledLabel: string): ConversationSummary[] {
  return groupActiveConversations([...all], "", untitledLabel).find(group => group.cwd === cwd)?.conversations ?? [];
}

export interface OverviewCounts {
  total: number;
  /** 正在回复或准备中。 */
  running: number;
  waiting: number;
  error: number;
}

export function overviewCounts(conversations: readonly ConversationSummary[], options: ActivityOptions): OverviewCounts {
  const counts: OverviewCounts = { total: conversations.length, running: 0, waiting: 0, error: 0 };
  for (const conversation of conversations) {
    const reason = activityReason(conversation, options);
    if (reason === "waiting") counts.waiting += 1;
    else if (reason === "error") counts.error += 1;
    if (conversation.status === "streaming" || conversation.status === "starting") counts.running += 1;
  }
  return counts;
}

export type AttentionKind = Extract<ActivityReason, "waiting" | "error"> | "operation";
const attentionOrder: Record<AttentionKind, number> = { waiting: 0, error: 1, operation: 2 };

export interface AttentionItem {
  kind: AttentionKind;
  /** 对话 id;git 操作没有对应对话。 */
  conversationId: string | null;
  updatedAt: number;
}

/** 需要用户处理的事项:等待回答、出错的对话,以及进行中的 merge/rebase 等 Git 操作。 */
export function attentionItems(
  conversations: readonly ConversationSummary[],
  options: ActivityOptions,
  git: Pick<WorkspaceOverviewGit, "operation"> | null,
): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const conversation of conversations) {
    const reason = activityReason(conversation, options);
    if (reason === "waiting" || reason === "error") {
      items.push({ kind: reason, conversationId: conversation.id, updatedAt: conversation.updatedAt });
    }
  }
  items.sort((a, b) => attentionOrder[a.kind] - attentionOrder[b.kind] || b.updatedAt - a.updatedAt);
  if (git?.operation) items.push({ kind: "operation", conversationId: null, updatedAt: 0 });
  return items;
}

export interface ActivityDay {
  /** 当天 0 点的时间戳。 */
  day: number;
  count: number;
}

/** 最近 days 天(含今天)每天新建的对话数,按本地日期分桶;跨夏令时也按日历日推进。 */
export function dailyCreatedConversations(conversations: readonly ConversationSummary[], now: number, days = overviewActivityDays): ActivityDay[] {
  const today = new Date(activityDay(now));
  const series: ActivityDay[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - offset);
    series.push({ day: date.getTime(), count: 0 });
  }
  const index = new Map(series.map((entry, position) => [entry.day, position]));
  for (const conversation of conversations) {
    const position = index.get(activityDay(conversation.createdAt));
    if (position !== undefined) series[position]!.count += 1;
  }
  return series;
}

export interface ChangeBreakdownPart {
  status: "modified" | "added" | "deleted" | "other";
  count: number;
}

/** 变更构成:新增含未跟踪文件,重命名与冲突归入其他;只返回数量大于 0 的部分。 */
export function changeBreakdown(counts: Record<GitFileStatus, number>): ChangeBreakdownPart[] {
  const parts: ChangeBreakdownPart[] = [
    { status: "modified", count: counts.modified },
    { status: "added", count: counts.added + counts.untracked },
    { status: "deleted", count: counts.deleted },
    { status: "other", count: counts.renamed + counts.conflicted },
  ];
  return parts.filter(part => part.count > 0);
}

export interface WorkspaceScheduleSummary {
  active: number;
  /** 最近的下一次执行时间;没有启用的任务时为 null。 */
  nextRunAt: number | null;
  next: ScheduledTask | null;
}

/** 这个工作区里的定时任务摘要:已暂停和已完成的不计入启用数。 */
export function scheduleSummary(tasks: readonly ScheduledTask[], workspace: string): WorkspaceScheduleSummary {
  const active = tasks.filter(task => task.workspace === workspace && task.status === "active");
  const upcoming = active.filter(task => task.nextRunAt !== null).sort((a, b) => a.nextRunAt! - b.nextRunAt!);
  return { active: active.length, nextRunAt: upcoming[0]?.nextRunAt ?? null, next: upcoming[0] ?? null };
}
