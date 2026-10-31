import { emptyAgentUsage, type AgentInfo, type ToolTrace } from "@vela/shared";

function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => sameValue(item, b[index]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => key in right && sameValue(left[key], right[key]));
}

/**
 * agents 事件每次都带完整快照，多数字段其实没变。
 * 内容相同的 agent 沿用旧对象，整份没变就返回旧数组，让下游的 memo 和 Context 不失效。
 */
export function reconcileAgents(previous: readonly AgentInfo[] | undefined, next: AgentInfo[]): AgentInfo[] {
  if (!previous) return next;
  const byId = new Map(previous.map((agent) => [agent.id, agent]));
  let changed = next.length !== previous.length;
  const merged = next.map((agent, index) => {
    const old = byId.get(agent.id);
    const reused = old && sameValue(old, agent) ? old : agent;
    if (reused !== previous[index]) changed = true;
    return reused;
  });
  return changed ? merged : (previous as AgentInfo[]);
}

/** 从一条已渲染的工具记录还原已结束子代理的快照。 */
function agentFromTool(tool: ToolTrace, agentId: string): AgentInfo {
  const activity = tool.activity;
  const path = activity?.agentPath ?? tool.name;
  const name = path.split("/").filter(Boolean).pop() ?? path;
  return {
    id: agentId,
    parentId: null,
    path,
    name,
    kind: activity?.agent ?? "general",
    status: tool.status === "running" ? "running" : tool.status === "error" ? "failed" : "completed",
    depth: 1,
    task: "",
    steps: activity?.steps ?? [],
    mutated: activity?.mutated === true,
    finalText: activity?.body ?? null,
    error: null,
    usage: { ...emptyAgentUsage },
    activeMs: 0,
    runningSince: null,
    pauseRequested: false,
    createdAt: 0,
    updatedAt: 0,
  };
}

/**
 * 从已渲染的工具记录里还原已结束子代理的快照，一次扫描建好索引。
 * agent 树只在内存里，应用重启后点击历史卡片时用它让 Agent Pane 仍能打开。
 * 同一个 agent 出现多次时取最靠后的消息（同一条消息内取最先的工具）。
 */
export function indexAgentHistory(messages: readonly { tools: readonly ToolTrace[] }[]): Map<string, AgentInfo> {
  const restored = new Map<string, AgentInfo>();
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const found = new Set<string>();
    for (const tool of messages[index]?.tools ?? []) {
      const id = tool.activity?.agentId;
      if (!id || restored.has(id) || found.has(id)) continue;
      found.add(id);
      restored.set(id, agentFromTool(tool, id));
    }
  }
  return restored;
}

/** 实时的子代理优先，历史里还原出来的补在后面。 */
export function mergeAgentRoster(live: readonly AgentInfo[], restored: ReadonlyMap<string, AgentInfo>): AgentInfo[] {
  const byId = new Map<string, AgentInfo>();
  for (const agent of live) {
    if (agent.kind !== "root") byId.set(agent.id, agent);
  }
  for (const [id, agent] of restored) {
    if (!byId.has(id)) byId.set(id, agent);
  }
  return [...byId.values()];
}
