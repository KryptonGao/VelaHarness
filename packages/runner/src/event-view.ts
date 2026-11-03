import type { RuntimeEvent } from "@vela/agent";
import { redactSensitive } from "@vela/shared";

const maxFieldChars = 4000;

/** 环境变量里看起来像凭据的值：输出前整体抹掉，避免模型回显时泄露。 */
export function environmentSecrets(env: NodeJS.ProcessEnv = process.env): string[] {
  const secrets: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    if (value && value.length >= 8 && /(?:key|token|secret|password|credential)/i.test(key)) secrets.push(value);
  }
  return secrets;
}

function clip(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return value.length > maxFieldChars ? `${value.slice(0, maxFieldChars)}…[truncated ${value.length - maxFieldChars} chars]` : value;
  if (depth > 8) return null;
  if (Array.isArray(value)) return value.slice(0, 200).map(item => clip(item, depth + 1));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clip(item, depth + 1)]));
  return value;
}

const droppedTypes = new Set<string>(["trace", "status", "thinking_delta", "tool_output", "background_shells"]);
const droppedAgentTypes = new Set<string>(["text_delta", "thinking_delta", "tool_output"]);

/**
 * 给 JSONL 用的 Runtime 事件视图：去掉思考过程、轨迹和流式工具输出，
 * 截断过长字段，再走现有脱敏。返回 null 表示不转发。
 */
export function runtimeEventView(event: RuntimeEvent, secrets: readonly string[]): unknown | null {
  if (droppedTypes.has(event.type)) return null;
  if (event.type === "agent_event" && droppedAgentTypes.has(event.event.type)) return null;
  return redactSensitive(clip(event), secrets);
}
