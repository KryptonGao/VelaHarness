import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ToolTrace } from "@vela/shared";
import type { UiMessage } from "../src/renderer/hooks/useSession.ts";
import {
  attachFollowerTools,
  buildTurnItems,
  coherentActions,
  countFailedTools,
  groupAgentStream,
  groupCoherentItems,
  groupProcessItems,
  isFlatCoherentGroup,
  latestThoughtId,
  shouldFoldRun,
  type ProcessNode,
} from "../src/renderer/components/tool-sequence.ts";

function tool(name: string, id: string): ToolTrace {
  return { id, name, status: "done", activity: {} };
}

function message(id: string, parts: Partial<UiMessage> = {}): UiMessage {
  return { id, role: "assistant", text: "", thinking: "", tools: [], ...parts };
}

function runToolIds(node: ProcessNode): string[] {
  return node.type === "run" ? node.tools.map((item) => item.id) : [];
}

describe("shouldFoldRun", () => {
  it("卡片模式达到 RUN_MIN 才折叠,紧凑模式超过 1 个就折叠", () => {
    assert.equal(shouldFoldRun(2, "card"), false);
    assert.equal(shouldFoldRun(3, "card"), true);
    assert.equal(shouldFoldRun(1, "compact"), false);
    assert.equal(shouldFoldRun(2, "compact"), true);
  });

  it("fold 为 none 时无论多少个都不折叠", () => {
    assert.equal(shouldFoldRun(3, "card", "none"), false);
    assert.equal(shouldFoldRun(10, "compact", "none"), false);
    assert.equal(shouldFoldRun(2, "compact", "position"), true);
  });
});

describe("buildTurnItems", () => {
  it("按界面顺序拍平思考、工具和正文", () => {
    const items = buildTurnItems([
      message("m1", { thinking: "先想", tools: [tool("bash", "b1")], text: "说得对" }),
    ]);
    assert.deepEqual(
      items.map((item) => item.kind),
      ["thinking", "tool", "text"],
    );
    assert.deepEqual(
      buildTurnItems([message("m2", { tools: [tool("read", "r1"), tool("edit", "e1")] })]).map((item) =>
        item.kind === "tool" ? item.tool.id : item.id,
      ),
      ["r1", "e1"],
    );
  });

  it("includeText 返回 false 的正文不进入序列", () => {
    const messages = [
      message("m1", { text: "过程说明", tools: [tool("bash", "b1")] }),
      message("m2", { text: "最终回复" }),
    ];
    const items = buildTurnItems(messages, { includeText: (item) => item.id !== "m2" });
    assert.deepEqual(
      items.map((item) => item.kind),
      ["tool", "text"],
    );
  });
});

describe("groupAgentStream", () => {
  const messages = [
    message("u1", { role: "user", text: "任务" }),
    message("a1", { tools: [tool("bash", "b1")] }),
    message("a2", { tools: [tool("read", "r1")] }),
    message("u2", { role: "user", text: "继续" }),
    message("a3", { tools: [tool("edit", "e1")] }),
  ];

  it("position 把相邻助理消息合成一块,用户消息单独一块并打断", () => {
    assert.deepEqual(
      groupAgentStream(messages, "position").map((block) => [block.role, block.messages.map((item) => item.id)]),
      [
        ["user", ["u1"]],
        ["assistant", ["a1", "a2"]],
        ["user", ["u2"]],
        ["assistant", ["a3"]],
      ],
    );
  });

  it("message 和 none 保持每条消息一块", () => {
    for (const fold of ["message", "none"] as const) {
      assert.deepEqual(
        groupAgentStream(messages, fold).map((block) => block.messages.map((item) => item.id)),
        [["u1"], ["a1"], ["a2"], ["u2"], ["a3"]],
      );
    }
  });

  it("合并后的块能跨消息把相邻工具归入同一组", () => {
    const block = groupAgentStream(messages, "position")[1]!;
    const nodes = groupProcessItems(buildTurnItems(block.messages), "compact");
    assert.deepEqual(nodes.map((node) => node.type), ["run"]);
    assert.deepEqual(runToolIds(nodes[0]!), ["b1", "r1"]);
  });
});

describe("groupProcessItems", () => {
  it("跨 Assistant 消息合并相邻工具,不受消息边界打断", () => {
    const items = buildTurnItems([
      message("m1", { tools: [tool("bash", "b1"), tool("read", "r1")] }),
      message("m2", { tools: [tool("edit", "e1")] }),
    ]);
    const nodes = groupProcessItems(items, "card");
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0]!.type, "run");
    assert.deepEqual(runToolIds(nodes[0]!), ["b1", "r1", "e1"]);
  });

  it("紧凑模式两个相邻工具就合并,卡片模式保持逐个展示", () => {
    const items = buildTurnItems([
      message("m1", { tools: [tool("bash", "b1")] }),
      message("m2", { tools: [tool("read", "r1")] }),
    ]);
    const compact = groupProcessItems(items, "compact");
    assert.deepEqual(compact.map((node) => node.type), ["run"]);
    assert.deepEqual(runToolIds(compact[0]!), ["b1", "r1"]);

    const card = groupProcessItems(items, "card");
    assert.deepEqual(card.map((node) => node.type), ["tool", "tool"]);
    assert.deepEqual(
      card.map((node) => (node.type === "tool" ? node.tool.id : node.id)),
      ["b1", "r1"],
    );
  });

  it("思考打断分组,前后工具各自成组", () => {
    const items = buildTurnItems([
      message("m1", { tools: [tool("bash", "b1"), tool("read", "r1"), tool("edit", "e1")] }),
      message("m2", { thinking: "换一步", tools: [tool("bash", "b2"), tool("read", "r2")] }),
      message("m3", { tools: [tool("edit", "e2"), tool("write", "w2")] }),
    ]);
    const nodes = groupProcessItems(items, "card");
    assert.deepEqual(nodes.map((node) => node.type), ["run", "thinking", "run"]);
    assert.deepEqual(runToolIds(nodes[0]!), ["b1", "r1", "e1"]);
    assert.deepEqual(runToolIds(nodes[2]!), ["b2", "r2", "e2", "w2"]);
  });

  it("可见正文打断分组", () => {
    const items = buildTurnItems([
      message("m1", { tools: [tool("bash", "b1"), tool("read", "r1")] }),
      message("m2", { text: "中间说明" }),
      message("m3", { tools: [tool("edit", "e1"), tool("write", "w1")] }),
    ]);
    const nodes = groupProcessItems(items, "compact");
    assert.deepEqual(nodes.map((node) => node.type), ["run", "text", "run"]);
  });

  it("标题思考跨过回复收纳工具,正文留在组外且顺序不变", () => {
    for (const display of ["compact", "card"] as const) {
      const nodes = groupProcessItems(buildTurnItems([
        message("a", { thinking: "**Implementing changes**\n\nReview the files.", text: "Starting.", tools: [tool("read", "r")] }),
        message("b", { text: "Continuing." }),
        message("c", { tools: [tool("edit", "e"), tool("bash", "b")] }),
        message("d", { text: "Done." }),
        message("next", { thinking: "**Checking results**\n\nRun tests.", tools: [tool("bash", "test")] }),
      ]), display);
      assert.deepEqual(nodes.map((node) => node.type), ["thinking", "run", "text", "text", "text", "thinking", "tool"]);
      assert.deepEqual(runToolIds(nodes[1]!), ["r", "e", "b"]);
      assert.deepEqual(nodes.filter((node) => node.type === "text").map((node) => node.text), ["Starting.", "Continuing.", "Done."]);
      assert.equal(nodes[6]!.type === "tool" && nodes[6]!.tool.id, "test");
    }
  });

  it("跨回复归入的单个工具保留来源,交互卡片仍单独渲染", () => {
    const nodes = groupProcessItems(buildTurnItems([
      message("a", { thinking: "**Implementing changes**\n\nReview the files.", text: "Starting." }),
      message("b", { tools: [tool("ask_user_question", "q")] }),
      message("c", { text: "Continuing.", tools: [tool("edit", "e")] }),
      message("d", { thinking: "plain reasoning", tools: [tool("read", "r")] }),
    ]), "compact");
    assert.deepEqual(nodes.map((node) => node.type), ["thinking", "tool", "tool", "text", "text", "thinking", "tool"]);
    assert.equal(nodes[1]!.messageId, "b");
    assert.equal(nodes[2]!.messageId, "c");
    assert.equal(nodes[6]!.messageId, "d");
  });

  it("交互卡片等不可折叠工具打断分组", () => {
    const items = buildTurnItems([
      message("m1", { tools: [tool("bash", "b1"), tool("read", "r1")] }),
      message("m2", { tools: [tool("submit_plan", "p1")] }),
      message("m3", { tools: [tool("edit", "e1"), tool("write", "w1")] }),
    ]);
    const nodes = groupProcessItems(items, "compact");
    assert.deepEqual(nodes.map((node) => node.type), ["run", "tool", "run"]);
    assert.equal(nodes[1]!.type === "tool" && nodes[1]!.tool.id, "p1");
  });
});

describe("countFailedTools", () => {
  it("counts only tools that ended in error", () => {
    const failed: ToolTrace = { ...tool("bash", "b"), status: "error" };
    const running: ToolTrace = { ...tool("bash", "c"), status: "running" };
    assert.equal(countFailedTools([tool("read", "a"), failed, running, failed]), 2);
    assert.equal(countFailedTools([]), 0);
  });
});

describe("attachFollowerTools", () => {
  const titled = "**Considering DOM manipulations**\n\nLooking at the toggle state.";

  it("moves tools from later thinking-less messages under the titled thinking", () => {
    const lead = message("a", { thinking: titled, tools: [tool("update_plan", "plan")] });
    const next = message("b", { tools: [tool("edit", "e1"), tool("edit", "e2")] });
    const last = message("c", {});
    const units = attachFollowerTools([lead, next, last]);
    assert.equal(units.length, 1);
    assert.deepEqual(units[0]!.message.tools.map((item) => item.id), ["plan", "e1", "e2"]);
    assert.deepEqual(units[0]!.memberIds, ["a", "b", "c"]);
    assert.equal(units[0]!.message.id, "a");
  });

  it("keeps tools after a reply in the preceding group and preserves the reply", () => {
    const lead = message("a", { thinking: titled });
    const reply = message("b", { text: "Done.", tools: [tool("bash", "t")] });
    const later = message("c", { tools: [tool("read", "r")] });
    const units = attachFollowerTools([lead, reply, later]);
    assert.deepEqual(units.map((unit) => unit.message.id), ["a", "b"]);
    assert.deepEqual(units[0]!.message.tools.map((item) => item.id), ["t", "r"]);
    assert.deepEqual(units[0]!.memberIds, ["a", "c"]);
    assert.deepEqual(units[1]!.message.tools, []);
    assert.equal(units[1]!.message.text, "Done.");
  });

  it("attaches across multiple replies even when the titled message has text", () => {
    const lead = message("a", { thinking: titled, text: "Starting.", tools: [tool("read", "r")] });
    const reply = message("b", { text: "Continuing." });
    const later = message("c", { tools: [tool("edit", "e")] });
    const done = message("d", { text: "Done." });
    const units = attachFollowerTools([lead, reply, later, done]);
    assert.deepEqual(units.map((unit) => unit.message.text), ["Starting.", "Continuing.", "Done."]);
    assert.deepEqual(units[0]!.message.tools.map((item) => item.id), ["r", "e"]);
    assert.deepEqual(units[0]!.memberIds, ["a", "c"]);
    assert.equal(lead.tools.length, 1);
    assert.equal(later.tools.length, 1);
  });

  it("starts a new group at the next titled thinking and at user messages", () => {
    const units = attachFollowerTools([
      message("a", { thinking: titled }),
      message("b", { text: "Continuing." }),
      message("c", { thinking: "**Next step**\n\nCheck the result.", text: "Checking." }),
      message("d", { tools: [tool("read", "r")] }),
      message("u", { role: "user", text: "New task." }),
      message("e", { tools: [tool("edit", "e")] }),
    ]);
    assert.deepEqual(units.map((unit) => unit.message.id), ["a", "b", "c", "u", "e"]);
    assert.deepEqual(units.map((unit) => unit.message.tools.map((item) => item.id)), [[], [], ["r"], [], ["e"]]);
  });

  it("refreshes merged tool status and removes tools when a follower gains thinking", () => {
    const lead = message("a", { thinking: titled, text: "Starting." });
    const running = message("b", { tools: [{ ...tool("edit", "e"), status: "running" }] });
    const first = attachFollowerTools([lead, running]);
    const completed = { ...running, tools: [tool("edit", "e")] };
    const second = attachFollowerTools([lead, completed]);
    assert.equal(first[0]!.message.tools[0]!.status, "running");
    assert.equal(second[0]!.message.tools[0]!.status, "done");
    assert.notEqual(first[0]!.message, second[0]!.message);
    const next = { ...completed, thinking: "**Next step**\n\nReview." };
    assert.deepEqual(attachFollowerTools([lead, next]).map((unit) => unit.message.tools.length), [0, 1]);
  });

  it("keeps the group live when a reply also contains a running tool", () => {
    const lead = message("a", { thinking: titled });
    const reply = message("b", { text: "Continuing.", tools: [{ ...tool("edit", "e"), status: "running" }] });
    const units = attachFollowerTools([lead, reply]);
    assert.deepEqual(units[0]!.memberIds, ["a", "b"]);
    assert.deepEqual(units[1]!.message.tools, []);
    const completed = { ...reply, tools: [tool("edit", "e")] };
    assert.deepEqual(attachFollowerTools([lead, completed])[0]!.memberIds, ["a"]);
  });

  it("stops at the next thinking and leaves untitled thinking alone", () => {
    const first = message("a", { thinking: titled, tools: [tool("read", "r1")] });
    const second = message("b", { thinking: "plain reasoning", tools: [tool("read", "r2")] });
    const after = message("c", { tools: [tool("read", "r3")] });
    const units = attachFollowerTools([first, second, after]);
    assert.deepEqual(units.map((unit) => unit.message.id), ["a", "b", "c"]);
    assert.deepEqual(units.map((unit) => unit.message.tools.length), [1, 1, 1]);
  });

  it("reuses merged messages while nothing changed", () => {
    const lead = message("a", { thinking: titled });
    const follower = message("b", { tools: [tool("read", "r")] });
    assert.equal(attachFollowerTools([lead, follower])[0]!.message, attachFollowerTools([lead, follower])[0]!.message);
  });
});

describe("groupCoherentItems", () => {
  it("splits groups only at replies and keeps arrival order inside a group", () => {
    const nodes = groupCoherentItems(buildTurnItems([
      message("a", { thinking: "**First**\n\nbody", tools: [tool("read", "r1")] }),
      message("b", { thinking: "second without title", tools: [tool("edit", "e1")], text: "Reply one." }),
      message("c", { thinking: "**Third**\n\nbody", tools: [tool("bash", "b1")] }),
      message("d", { text: "Reply two." }),
    ]));
    assert.deepEqual(nodes.map((node) => node.type), ["group", "text", "group", "text"]);
    const first = nodes[0]!;
    assert.equal(first.type === "group" && first.id, "a");
    assert.deepEqual(
      first.type === "group" ? first.entries.map((entry) => entry.type === "tool" ? entry.tool.id : entry.id) : [],
      ["a", "r1", "b", "e1"],
    );
    const second = nodes[2]!;
    assert.deepEqual(second.type === "group" ? second.entries.map((entry) => entry.type) : [], ["thinking", "tool"]);
    assert.deepEqual(nodes.filter((node) => node.type === "text").map((node) => node.text), ["Reply one.", "Reply two."]);
  });

  it("keeps interactive and non-foldable tools inside the group", () => {
    const nodes = groupCoherentItems(buildTurnItems([
      message("a", { tools: [tool("ask_user_question", "q"), tool("web_search", "w")] }),
    ]));
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0]!.type === "group" && nodes[0]!.entries.length, 2);
  });

  it("starts a new group after consecutive replies and ignores blank thinking", () => {
    const nodes = groupCoherentItems(buildTurnItems([
      message("a", { text: "One." }),
      message("b", { thinking: "   ", text: "Two." }),
      message("c", { tools: [tool("read", "r")] }),
    ]));
    assert.deepEqual(nodes.map((node) => node.type), ["text", "text", "group"]);
  });

  it("keeps the group id stable while entries are appended", () => {
    const early = groupCoherentItems(buildTurnItems([message("a", { thinking: "**One**\n\nx" })]));
    const later = groupCoherentItems(buildTurnItems([message("a", { thinking: "**One**\n\nx", tools: [tool("read", "r")] }), message("b", { tools: [tool("bash", "b1")] })]));
    assert.equal(early[0]!.id, later[0]!.id);
  });
});

describe("coherentActions", () => {
  const entries = (...names: string[]) => groupCoherentItems(buildTurnItems([
    message("m", { thinking: "t", tools: names.map((name, index) => tool(name, `t${index}`)) }),
  ])).flatMap((node) => node.type === "group" ? node.entries : []);

  it("lists edit, read, bash in a fixed order regardless of arrival", () => {
    assert.deepEqual(coherentActions(entries("bash", "read", "edit")), ["edit", "read", "bash"]);
  });

  it("counts write as edit and lists any other tool as used tools last", () => {
    assert.deepEqual(coherentActions(entries("write", "web_search", "grep")), ["edit", "tools"]);
    assert.deepEqual(coherentActions(entries("web_search", "bash")), ["bash", "tools"]);
    assert.deepEqual(coherentActions(groupCoherentItems(buildTurnItems([message("m", { thinking: "t" })])).flatMap((node) => node.type === "group" ? node.entries : [])), []);
  });

  it("flattens groups with at most three tool calls", () => {
    const entriesOf = (count: number) => groupCoherentItems(buildTurnItems([
      message("m", { thinking: "t", tools: Array.from({ length: count }, (_, index) => tool("read", `r${index}`)) }),
    ])).flatMap((node) => node.type === "group" ? node.entries : []);
    assert.equal(isFlatCoherentGroup(entriesOf(0)), true);
    assert.equal(isFlatCoherentGroup(entriesOf(3)), true);
    assert.equal(isFlatCoherentGroup(entriesOf(4)), false);
  });
});

describe("latestThoughtId", () => {
  it("returns the last thinking entry, skipping tools after it", () => {
    const entries = groupCoherentItems(buildTurnItems([
      message("a", { thinking: "first", tools: [tool("read", "r1")] }),
      message("b", { thinking: "second", tools: [tool("bash", "b1")] }),
    ])).flatMap((node) => node.type === "group" ? node.entries : []);
    assert.equal(latestThoughtId(entries), "b");
  });

  it("is null when the group has no thinking", () => {
    const entries = groupCoherentItems(buildTurnItems([message("a", { tools: [tool("read", "r1")] })]))
      .flatMap((node) => node.type === "group" ? node.entries : []);
    assert.equal(latestThoughtId(entries), null);
  });
});
