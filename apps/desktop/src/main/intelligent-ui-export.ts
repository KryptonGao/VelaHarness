import {
  mayContainUi,
  parseUiMessage,
  parseUiStateSnapshot,
  resolveUiSource,
  restoreUiValues,
  summarizeUiArtifact,
  uiSourceFingerprint,
  uiStateStorageKey,
  type UiArtifact,
  type UiSourceSnapshot,
  type UiToolCall,
  type UiValue,
} from "@vela/shared";

/** 读取渲染层保存的本地状态快照（原始 JSON 字符串）；没有返回 null。 */
export type UiStateReader = (key: string) => string | null | undefined;

export interface UiExportContext {
  conversationId: string;
  readUiState?: UiStateReader;
  /** 界面无法导出时的占位文案。 */
  omitted: string;
  /** 界面块的标题行，例如「交互界面（静态文字版）」。 */
  label: string;
  /** 微应用（vela-app）不会被导出：它是脚本，只留一行说明。 */
  appOmitted?: string;
  /** 截至这条回复（含）为止、会话里真实的工具调用；数据源只能从这里取值。 */
  toolCalls?: readonly UiToolCall[];
  /** 解析数据源「是否过期」用的当前时间，默认取导出时刻。 */
  now?: number;
}

/**
 * 助手回复里的 vela-ui 块在导出中变成纯文字等价物：不含脚本、HTML 或可点击的动作。
 * 位置序号 u{n} 的算法必须和渲染层（SessionChatView）一致：第 n 条「可能含界面」的助手回复。
 */
export class UiExportNumbering {
  private count = 0;

  /** 返回这条回复的稳定位置 id；不含界面的回复返回 null，且不占序号。 */
  next(text: string): string | null {
    if (!mayContainUi(text)) return null;
    const id = `u${this.count}`;
    this.count += 1;
    return id;
  }
}

function readSaved(context: UiExportContext, messageId: string, artifactId: string, raw: string): Record<string, UiValue> | null {
  if (!context.readUiState) return null;
  try {
    const stored = context.readUiState(uiStateStorageKey({ conversationId: context.conversationId, messageId, artifactId }));
    return parseUiStateSnapshot(stored, uiSourceFingerprint(artifactId, raw));
  } catch {
    return null;
  }
}

function resolveSnapshots(artifact: UiArtifact, context: UiExportContext): Map<string, UiSourceSnapshot> | undefined {
  if (artifact.sources.length === 0) return undefined;
  const calls = context.toolCalls ?? [];
  const now = context.now ?? Date.now();
  return new Map(artifact.sources.map(source => [source.name, resolveUiSource(source, calls, { now, receiving: false })] as const));
}

export function exportAssistantText(text: string, messageId: string | null, context: UiExportContext): string {
  if (messageId === null) return text;
  const parts: string[] = [];
  for (const segment of parseUiMessage(text)) {
    if (segment.type === "markdown") {
      if (segment.text.trim()) parts.push(segment.text.replace(/^\n+|\n+$/g, ""));
      continue;
    }
    if (segment.type === "app") {
      parts.push(`*${context.appOmitted ?? context.omitted}*`);
      continue;
    }
    const saved = readSaved(context, messageId, segment.artifact.artifactId, segment.raw);
    const summary = summarizeUiArtifact(segment.artifact, restoreUiValues(segment.artifact, saved ?? undefined), resolveSnapshots(segment.artifact, context));
    parts.push(summary.trim() ? `**${context.label}**\n\n${summary}` : `*${context.omitted}*`);
  }
  return parts.join("\n\n");
}
