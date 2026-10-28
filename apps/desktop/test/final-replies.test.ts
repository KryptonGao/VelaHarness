import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ToolTrace } from "@vela/shared";
import type { UiMessage } from "../src/renderer/hooks/useSession.ts";
import { selectFinalReplies } from "../src/renderer/components/final-replies.ts";

function tool(name: string): ToolTrace {
  return { id: `${name}-call`, name, status: "done" };
}

function assistant(id: string, text: string, tools: ToolTrace[] = []): UiMessage {
  return { id, role: "assistant", text, thinking: "", tools };
}

describe("final reply selection", () => {
  it("keeps the answer visible when a short sign-off follows recommend_actions", () => {
    const answer = assistant("answer", "做好了，雙擊 index.html 就能開席。", [tool("recommend_actions")]);
    const signOff = assistant("sign-off", "已完成。");
    const replies = selectFinalReplies([assistant("work", "", [tool("bash")]), answer, signOff]);
    assert.deepEqual(replies.map((reply) => reply.id), ["answer", "sign-off"]);
  });

  it("merges consecutive prose messages and skips thinking-only ones between them", () => {
    const thinking: UiMessage = { ...assistant("think", ""), thinking: "hmm" };
    const replies = selectFinalReplies([assistant("a", "first"), thinking, assistant("b", "second")]);
    assert.deepEqual(replies.map((reply) => reply.id), ["a", "b"]);
  });

  it("leaves narration before real tool calls in the process", () => {
    const replies = selectFinalReplies([
      assistant("narration", "我先看一下文件。", [tool("read")]),
      assistant("answer", "结论如下。"),
    ]);
    assert.deepEqual(replies.map((reply) => reply.id), ["answer"]);
  });

  it("returns nothing when no message has text", () => {
    assert.deepEqual(selectFinalReplies([assistant("tools", "", [tool("bash")])]), []);
  });
});
