/** 真实 App 加内存侧边聊天服务；复用聊天标签夹具的会话服务。 */
import type { SideChatEvent, SideChatRequest, SideChatResult } from "@vela/shared";
import "./workbench-chat-preview";
import "../src/renderer/side-chat.css";

const listeners = new Set<(event: SideChatEvent) => void>();
const requests: SideChatRequest[] = [];
const cancelled: string[] = [];
type Memory = Extract<SideChatEvent, { type: "memory" }>;
const pending = new Map<string, { resolve: (result: SideChatResult) => void; reject: (error: Error) => void; text: string; memory?: Memory }>();
const last = () => requests.at(-1)!;
const result = (id: string, text: string, aborted: boolean): SideChatResult => {
  const memory = pending.get(id)?.memory;
  return { requestId: id, text, model: "fixture/one", memory: memory?.memory ?? [], memoryEnabled: memory?.memoryEnabled ?? true, aborted };
};
const sideChatFixture = {
  requests, cancelled,
  memory(enabled = true) {
    const scopes = enabled ? [["global", null], ["project", "/projects/VelaHarness"]] as const : [];
    const memory = scopes.map(([scope, workspace]) => ({ scope, workspace, path: `${workspace ?? "~/.vela"}/MEMORY.md`, status: "loaded" as const, bytes: 12, error: null, message: null }));
    const event: Memory = { requestId: last().requestId, type: "memory", memory, memoryEnabled: enabled, model: "fixture/one" };
    pending.get(last().requestId)!.memory = event;
    for (const listener of listeners) listener(event);
  },
  delta(text: string) {
    pending.get(last().requestId)!.text += text;
    for (const listener of listeners) listener({ requestId: last().requestId, type: "delta", text });
  },
  finish() { const entry = pending.get(last().requestId)!; const done = result(last().requestId, entry.text, false); pending.delete(last().requestId); entry.resolve(done); },
  fail(message: string) { const entry = pending.get(last().requestId)!; pending.delete(last().requestId); entry.reject(new Error(message)); },
};
(window as unknown as { sideChatFixture: typeof sideChatFixture }).sideChatFixture = sideChatFixture;
window.vela!.sideChat = {
  send: request => new Promise((resolve, reject) => {
    requests.push(structuredClone(request));
    pending.set(request.requestId, { resolve, reject, text: "" });
  }),
  cancel: async (requestId) => {
    cancelled.push(requestId);
    const entry = pending.get(requestId);
    if (!entry) return;
    const done = result(requestId, entry.text, true);
    pending.delete(requestId);
    entry.resolve(done);
  },
  onEvent: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
};
