import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseRecommendedActions, recommendedActionLimits, type ToolTrace } from "@vela/shared";
import { latestRecommendedActions } from "../src/renderer/components/recommended-actions.ts";
import type { UiMessage } from "../src/renderer/hooks/useSession.ts";

const recommendation = { question: "要提交吗？", actions: [{ label: "提交", prompt: "请提交" }] };

function tool(id: string, name: string, status: ToolTrace["status"], extra: Partial<ToolTrace["activity"]> = {}): ToolTrace {
  return { id, name, status, activity: { ...extra } } as ToolTrace;
}
function message(id: string, role: UiMessage["role"], tools: ToolTrace[] = []): UiMessage {
  return { id, role, text: "x", thinking: "", tools };
}

describe("parseRecommendedActions", () => {
  it("清理空白，丢弃无效操作并限制数量与长度", () => {
    const parsed = parseRecommendedActions({
      question: "  下一步？ ",
      actions: [
        { label: " 提交 ", prompt: " 请提交 " },
        { label: "", prompt: "没有标签" },
        { label: "没有指令", prompt: "  " },
        { label: "a".repeat(100), prompt: "p" },
        { label: "三", prompt: "3" },
        { label: "四", prompt: "4" },
      ],
    });
    assert.equal(parsed?.question, "下一步？");
    assert.equal(parsed?.actions.length, recommendedActionLimits.maxActions);
    assert.deepEqual(parsed?.actions[0], { label: "提交", prompt: "请提交" });
    assert.equal(parsed?.actions[1]!.label.length, recommendedActionLimits.labelLength);
  });

  it("接受 JSON 字符串，其余输入返回 null", () => {
    assert.deepEqual(parseRecommendedActions(JSON.stringify(recommendation)), recommendation);
    for (const bad of [null, "nope", [], {}, { question: "", actions: recommendation.actions }, { question: "q", actions: [] }, { question: "q" }]) {
      assert.equal(parseRecommendedActions(bad), null);
    }
  });
});

describe("latestRecommendedActions", () => {
  const done = tool("t1", "recommend_actions", "done", { recommendedActions: recommendation });

  it("取最后一轮里已完成的推荐", () => {
    const messages = [message("u1", "user"), message("a1", "assistant", [done])];
    assert.deepEqual(latestRecommendedActions(messages), { id: "t1", recommendation });
  });

  it("新一轮开始后旧推荐不再显示", () => {
    assert.equal(latestRecommendedActions([message("u1", "user"), message("a1", "assistant", [done]), message("u2", "user")]), null);
  });

  it("运行中、失败或没有数据的调用不产生卡片", () => {
    assert.equal(latestRecommendedActions([message("a1", "assistant", [tool("t", "recommend_actions", "running", { recommendedActions: recommendation })])]), null);
    assert.equal(latestRecommendedActions([message("a1", "assistant", [tool("t", "recommend_actions", "error")])]), null);
    assert.equal(latestRecommendedActions([message("a1", "assistant", [tool("t", "bash", "done")])]), null);
  });
});
