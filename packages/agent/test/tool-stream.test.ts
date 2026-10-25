import assert from "node:assert/strict";
import test from "node:test";
import { ToolStreamTracker, streamedFileActivity } from "../src/tool-stream.ts";

test("write 的行数随未写完的 content 增长，路径写完整后才出现", () => {
  assert.deepEqual(streamedFileActivity("write", '{"path":"src/a.ts","content":"one\\ntwo\\nthr'), {
    path: "src/a.ts",
    diff: "+1 one\n+2 two\n+3 thr",
    streaming: { added: 3, removed: 0 },
  });
  assert.deepEqual(streamedFileActivity("write", '{"path":"src/a'), { streaming: { added: 0, removed: 0 } });
});

test("edit 把 oldText 记为删除、newText 记为新增，转义的引号不会被当成键", () => {
  const raw = '{"path":"a.ts","edits":[{"oldText":"a\\n\\"newText\\": \\"x\\"","newText":"b\\nc\\n"},{"oldText":"z","newText":"';
  assert.deepEqual(streamedFileActivity("edit", raw).streaming, { added: 2, removed: 3 });
  assert.equal(streamedFileActivity("edit", raw).diff, '-1 a\n-2 "newText": "x"\n+1 b\n+2 c\n…\n-1 z');
});

test("write 很长时 diff 只保留最近的行，行数统计仍然完整", () => {
  const content = Array.from({ length: 1000 }, (_, index) => `l${index}`).join("\\n");
  const activity = streamedFileActivity("write", `{"path":"a.ts","content":"${content}`);
  assert.equal(activity.streaming?.added, 1000);
  assert.equal(activity.diff?.split("\n").length, 401);
  assert.ok(activity.diff?.endsWith("l999"));
});

test("tracker 先报 tool_start，再按间隔报进度，toolcall_end 必报，执行后不再收尾", () => {
  let now = 0;
  const tracker = new ToolStreamTracker(() => now);
  const partial = { content: [{ type: "toolCall", id: "call-1", name: "write" }] };
  const first = tracker.update({ type: "toolcall_start", contentIndex: 0, partial });
  assert.equal(first?.first, true);
  assert.equal(first?.toolCallId, "call-1");
  now = 10;
  assert.equal(tracker.update({ type: "toolcall_delta", contentIndex: 0, delta: '{"content":"a\\nb', partial }), null);
  now = 200;
  const next = tracker.update({ type: "toolcall_delta", contentIndex: 0, delta: '\\nc"', partial });
  assert.equal(next?.first, false);
  assert.deepEqual(next?.activity.streaming, { added: 3, removed: 0 });
  now = 201;
  assert.ok(tracker.update({ type: "toolcall_end", contentIndex: 0, toolCall: { id: "call-1", name: "write", arguments: {} }, partial }));
  assert.deepEqual(tracker.settle(false), []);
  tracker.executed("call-1");
});

test("其他工具不产生进度；被中断或没写完的调用由 settle 收尾", () => {
  const tracker = new ToolStreamTracker(() => 0);
  const bash = { content: [{ type: "toolCall", id: "b", name: "bash" }] };
  assert.equal(tracker.update({ type: "toolcall_start", contentIndex: 0, partial: bash }), null);
  const edit = { content: [{ type: "toolCall", id: "e", name: "edit" }] };
  tracker.update({ type: "toolcall_start", contentIndex: 0, partial: edit });
  assert.deepEqual(tracker.settle(false).map((call) => call.toolCallId), ["e"]);
});
