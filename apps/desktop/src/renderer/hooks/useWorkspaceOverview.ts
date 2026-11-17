import { useCallback, useEffect, useRef, useState } from "react";
import type { HooksCatalog, McpCatalog, ScheduledTasksState, WorkspaceOverviewSnapshot } from "@vela/shared";

export interface OverviewMemory {
  exists: boolean;
  bytes: number;
  /** 记忆文件里的条目(以 - 或 * 开头的行),已去掉 Markdown 标记。 */
  entries: string[];
}

export interface WorkspaceOverviewData {
  snapshot: WorkspaceOverviewSnapshot | null;
  snapshotError: string | null;
  schedule: ScheduledTasksState | null;
  memory: OverviewMemory | null;
  mcp: McpCatalog | null;
  hooks: HooksCatalog | null;
  /** 首次读取尚未完成。 */
  loading: boolean;
}

const emptyData: WorkspaceOverviewData = { snapshot: null, snapshotError: null, schedule: null, memory: null, mcp: null, hooks: null, loading: true };
const gitRefreshDelayMs = 400;

/** 把项目 MEMORY.md 里的条目行取出来:去掉列表符号、粗体和反引号,忽略标题与空行。 */
export function parseMemoryEntries(content: string): string[] {
  const entries: string[] = [];
  for (const line of content.split("\n")) {
    const match = /^\s*[-*]\s+(.*\S)\s*$/.exec(line);
    if (!match) continue;
    const text = match[1]!.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_`]/g, "").trim();
    if (text) entries.push(text);
  }
  return entries;
}

/**
 * 读取一个工作区总览需要的数据。每一块独立读取、独立失败:
 * 某个来源不可用时只是那一块不显示,不影响其他卡片。
 * 窗口重新获得焦点和 Git 状态变化时刷新。
 */
export function useWorkspaceOverview(workspace: string): WorkspaceOverviewData {
  const [data, setData] = useState<WorkspaceOverviewData>(emptyData);
  const generation = useRef(0);

  const load = useCallback(async () => {
    const api = window.vela;
    if (!api) return;
    const current = ++generation.current;
    const live = () => generation.current === current;
    const patch = (next: Partial<WorkspaceOverviewData>) => { if (live()) setData(previous => ({ ...previous, ...next })); };
    await Promise.allSettled([
      api.workspaceOverview?.get(workspace).then(
        snapshot => patch({ snapshot, snapshotError: null }),
        (error: unknown) => patch({ snapshotError: error instanceof Error ? error.message : String(error) }),
      ),
      api.memory.list().then(async result => {
        if (!result.ok) return;
        const entry = result.value.projects.find(item => item.workspace === workspace);
        if (!entry || !entry.exists) { patch({ memory: { exists: false, bytes: 0, entries: [] } }); return; }
        const document = await api.memory.read({ scope: "project", workspace });
        patch({ memory: { exists: true, bytes: entry.bytes, entries: document.ok ? parseMemoryEntries(document.value.content) : [] } });
      }).catch(() => undefined),
      api.getMcpCatalog({ cwd: workspace }).then(mcp => patch({ mcp })).catch(() => undefined),
      api.getHooksCatalog({ cwd: workspace }).then(hooks => patch({ hooks })).catch(() => undefined),
      api.scheduledTasks?.list().then(schedule => patch({ schedule })).catch(() => undefined),
    ]);
    patch({ loading: false });
  }, [workspace]);

  useEffect(() => {
    setData(emptyData);
    void load();
    const api = window.vela;
    let timer: number | undefined;
    const refreshSoon = () => { window.clearTimeout(timer); timer = window.setTimeout(() => void load(), gitRefreshDelayMs); };
    const offGit = api?.onGitEvent(refreshSoon);
    const offTasks = api?.scheduledTasks?.subscribe(schedule => setData(previous => ({ ...previous, schedule })));
    window.addEventListener("focus", refreshSoon);
    return () => {
      generation.current += 1;
      window.clearTimeout(timer);
      offGit?.();
      offTasks?.();
      window.removeEventListener("focus", refreshSoon);
    };
  }, [load]);

  return data;
}
