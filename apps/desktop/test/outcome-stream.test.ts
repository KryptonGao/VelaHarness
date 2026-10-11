import assert from "node:assert/strict";
import { it } from "node:test";
import type { OutcomeSubmission } from "@vela/shared";
import { applyStreamEvent, toUiMessage, type MessageBuckets } from "../src/renderer/hooks/useSession.ts";
import { outcomeByFinalMessage } from "../src/renderer/components/acceptance.ts";
const outcome: OutcomeSubmission = { items: [{ requirement: "实现要求", status: "done", files: ["a.ts"], verificationIds: ["test"], toConfirm: [] }] };
it("preserves outcome through real renderer live sanitization, patches, completion and transcript restore", () => {
  let messages: MessageBuckets = { c: [{ id: "u", role: "user", text: "实现要求", thinking: "", tools: [] }] };
  messages = applyStreamEvent(messages, { type: "assistant_start", conversationId: "c", messageId: "a" });
  for (const tool of [
    { id: "edit", name: "edit", activity: { path: "a.ts", diff: "+1 ready" } },
    { id: "test", name: "bash", activity: { command: "pnpm test", body: "PASS" } },
    { id: "submit", name: "submit_outcome", activity: { outcome } },
  ]) {
    messages = applyStreamEvent(messages, { type: "tool_start", conversationId: "c", toolCallId: tool.id, toolName: tool.name, activity: tool.activity });
    messages = applyStreamEvent(messages, { type: "tool_output", conversationId: "c", toolCallId: tool.id, activity: { body: "output" } });
    if (tool.id === "submit") assert.deepEqual(messages.c.at(-1)!.tools.at(-1)!.activity.outcome, outcome);
    messages = applyStreamEvent(messages, { type: "tool_end", conversationId: "c", toolCallId: tool.id, toolName: tool.name, isError: false, activity: tool.activity });
  }
  assert.deepEqual(messages.c.at(-1)!.tools.at(-1)!.activity.outcome, outcome);
  const request = outcomeByFinalMessage(messages.c, false, "/repo").values().next().value!;
  assert.equal(request.outcome.source, "agent");
  assert.deepEqual(request.outcome.items[0].toConfirm, []);
  const restored = toUiMessage({ id: "a", role: "assistant", text: "done", thinking: "", timestamp: 1,
    tools: [{ id: "submit", name: "submit_outcome", status: "done", activity: { outcome } }] });
  assert.deepEqual(restored.tools[0].activity.outcome, outcome);
});
