import type { AgentStreamEvent } from "@vela/shared";

type Timer = ReturnType<typeof setTimeout>;

export interface StreamCoalescerOptions {
  /** 合并窗口；同一个子代理在窗口内连续到达的同类 delta 合成一条 IPC。 */
  intervalMs?: number;
  setTimer?: (fn: () => void, ms: number) => Timer;
  clearTimer?: (timer: Timer) => void;
}

type AgentDeltaEvent = Extract<AgentStreamEvent, { type: "agent_event" }> & {
  event: { type: "text_delta" | "thinking_delta"; delta: string };
};

function isAgentDelta(event: AgentStreamEvent): event is AgentDeltaEvent {
  return event.type === "agent_event" && (event.event.type === "text_delta" || event.event.type === "thinking_delta");
}

/**
 * 子代理每个 token 都是一个事件，N 个子代理同时跑就是 N 倍 IPC。
 * 这里把同一个子代理连续的 text_delta / thinking_delta 攒在一起，按固定间隔或遇到别的事件时再发。
 * 顺序约束：同一子代理里类型切换、或出现它的其他事件（工具、结束）时，先把攒着的发掉；
 * 主对话之外的事件（状态、错误等）同样先发掉同一对话下攒着的内容。
 * 主对话自己的 delta 不参与合并，也不会冲掉其他子代理的缓冲。
 */
export class StreamCoalescer {
  private readonly pending = new Map<string, AgentDeltaEvent>();
  private timer: Timer | null = null;
  private readonly intervalMs: number;
  private readonly setTimer: (fn: () => void, ms: number) => Timer;
  private readonly clearTimer: (timer: Timer) => void;

  constructor(private readonly send: (event: AgentStreamEvent) => void, options: StreamCoalescerOptions = {}) {
    this.intervalMs = options.intervalMs ?? 16;
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));
  }

  push(event: AgentStreamEvent): void {
    if (isAgentDelta(event)) {
      const key = slotKey(event.conversationId, event.agentId);
      const held = this.pending.get(key);
      if (held && held.event.type === event.event.type) {
        held.event = { type: held.event.type, delta: held.event.delta + event.event.delta };
        return;
      }
      if (held) this.flushKey(key);
      this.pending.set(key, { ...event, event: { ...event.event } });
      this.arm();
      return;
    }
    if (event.type === "agent_event") {
      this.flushKey(slotKey(event.conversationId, event.agentId));
    } else if (event.type !== "text_delta" && event.type !== "thinking_delta" && "conversationId" in event) {
      this.flushConversation(event.conversationId);
    } else if (event.type === "state") {
      this.flush();
    }
    this.send(event);
  }

  /** 把缓冲全部发出，用于窗口销毁或应用退出前。 */
  flush(): void {
    this.disarm();
    const events = [...this.pending.values()];
    this.pending.clear();
    for (const event of events) this.send(event);
  }

  private flushKey(key: string): void {
    const held = this.pending.get(key);
    if (!held) return;
    this.pending.delete(key);
    if (this.pending.size === 0) this.disarm();
    this.send(held);
  }

  private flushConversation(conversationId: string): void {
    for (const [key, held] of [...this.pending]) {
      if (held.conversationId === conversationId) this.flushKey(key);
    }
  }

  private arm(): void {
    if (this.timer) return;
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.flush();
    }, this.intervalMs);
  }

  private disarm(): void {
    if (!this.timer) return;
    this.clearTimer(this.timer);
    this.timer = null;
  }
}

function slotKey(conversationId: string, agentId: string): string {
  return `${conversationId}\u0000${agentId}`;
}
