import type { AgentStreamEvent } from "@vela/shared";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && "type" in value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** 主进程广播的对话事件白名单；不在这里的类型到不了渲染层。 */
export function isStreamEvent(value: unknown): value is AgentStreamEvent {
  if (!isRecord(value)) return false;
  const type = value.type;
  if (type === "trace") {
    return typeof value.conversationId === "string" && typeof value.version === "number" && Array.isArray(value.nodes) && Array.isArray(value.requests);
  }
  if (type === "user_message") {
    return typeof value.conversationId === "string" && typeof value.text === "string";
  }
  if (type === "agents") {
    return typeof value.conversationId === "string" && Array.isArray(value.agents);
  }
  if (type === "background_shells") {
    return typeof value.conversationId === "string" && Array.isArray(value.shells);
  }
  if (type === "agent_event") {
    return (
      typeof value.conversationId === "string" &&
      typeof value.agentId === "string" &&
      isObject(value.event)
    );
  }
  // 计划卡片靠这三类事件挂到消息上；漏掉它们，计划要等重新加载历史才会出现在对话流里。
  if (type === "proposed_plan_start") {
    return typeof value.conversationId === "string" && typeof value.planId === "string" && typeof value.revision === "number";
  }
  if (type === "proposed_plan_delta") {
    return typeof value.conversationId === "string" && typeof value.planId === "string" && typeof value.delta === "string";
  }
  if (type === "proposed_plan_end") {
    return typeof value.conversationId === "string" && isObject(value.plan) && typeof value.plan.id === "string";
  }
  return (
    type === "state" ||
    type === "text_delta" ||
    type === "thinking_delta" ||
    type === "assistant_start" ||
    type === "assistant_update" ||
    type === "assistant_end" ||
    type === "tool_start" ||
    type === "tool_output" ||
    type === "tool_end" ||
    type === "error"
  );
}
