import assert from "node:assert/strict";
import test from "node:test";
import { boundToolJson, parseToolPresentation, type JsonValue, type ToolPresentation } from "../src/tool-presentation.ts";

const base = { version: 1 as const, source: "result" as const };
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

// 编译时检查判别联合、数据字段和调用来源；不引入可执行值。
function typeContract(presentation: ToolPresentation): void {
  if (presentation.kind === "shell") {
    const operation: "start" | "read" | "kill" = presentation.operation;
    const exit: number | null | undefined = presentation.shell.exitCode;
    void operation; void exit;
    // @ts-expect-error shell 没有 memory.entries
    void presentation.entries;
  }
  // @ts-expect-error 只支持 version: 1
  const unknownVersion: ToolPresentation = { version: 2, source: "result", kind: "notice", code: "browser-reset" };
  // @ts-expect-error JSON 不能包含函数
  const executable: JsonValue = { run: () => "bad" };
  void unknownVersion; void executable;
}
void typeContract;

test("八种展示类别经过校验，复制数据且不改变调用方对象", () => {
  const examples: ToolPresentation[] = [
    { ...base, kind: "shell", operation: "read", shell: { id: "bg-1", command: "node a.mjs", status: "exited", exitCode: 1, endedAt: null }, output: "oops" },
    { ...base, kind: "memory", operation: "read", entries: [{ scope: "project", bytes: 0, exists: false, content: "" }] },
    { ...base, kind: "schedule", operation: "list", tasks: [{ id: "t1", schedule: { kind: "daily", time: "22:00" } }], runs: [] },
    { ...base, kind: "discovery", query: "notion", limit: 2, tools: [{ name: "mcp__notion__search", description: "Search" }] },
    { ...base, kind: "resource", operation: "read", server: "docs", uri: "doc://a", value: { contents: [{ text: "hello" }] } },
    { ...base, kind: "goal", goal: { status: "complete" }, validation: { checks: [] }, requested: { status: "complete" } },
    { ...base, kind: "json", value: { nil: null, empty: "", no: false, zero: 0, list: [], object: {} } },
    { ...base, kind: "notice", code: "browser-reset" },
  ];
  for (const example of examples) {
    const parsed = parseToolPresentation(example);
    assert.deepEqual(plain(parsed), example);
    assert.notEqual(parsed, example);
    assert.equal(Object.hasOwn(example, "truncated"), false);
  }
});

test("未知版本、类别、来源及必需字段损坏时安全回退", () => {
  const invalid: unknown[] = [null, [], "{}", {}, { ...base, version: 2, kind: "json", value: 1 },
    { ...base, kind: "__proto__", value: {} }, { ...base, source: "model", kind: "json", value: 1 },
    { ...base, kind: "json" }, { ...base, kind: "notice", code: "eval" }, { ...base, kind: "goal" },
    { ...base, kind: "shell", operation: "read", shell: {} },
    { ...base, kind: "shell", operation: "read", shell: { id: "a", exitCode: "1" } },
    { ...base, kind: "shell", operation: "read", shell: { id: "a", startedAt: NaN } },
    { ...base, kind: "shell", operation: "read", shell: { id: "a", status: "invented-success" } },
    { ...base, kind: "memory", operation: "read", entries: [{ scope: "global", status: "invented-success" }] },
    { ...base, kind: "memory", operation: "read", entries: [{ scope: "global", exists: "false" }] },
    { ...base, kind: "memory", operation: "read", entries: [{ scope: "global", bytes: -1 }] },
    { ...base, kind: "schedule", operation: "drop", tasks: [], runs: [] },
    { ...base, kind: "schedule", operation: "list", tasks: {}, runs: [] },
    { ...base, kind: "discovery", tools: [{}] }, { ...base, kind: "discovery", limit: 1.5, tools: [] },
    { ...base, kind: "resource", operation: "read" },
    { ...base, kind: "resource", operation: "read", value: {}, server: 3 },
    { ...base, kind: "json", value: 1, truncated: "yes" },
  ];
  for (const value of invalid) assert.equal(parseToolPresentation(value), undefined, JSON.stringify(value));
});

test("非 JSON 值、循环、类实例和 getter 不会被执行或传递", () => {
  let read = 0;
  const getter = Object.defineProperty({}, "secret", { enumerable: true, get() { read++; throw new Error("getter"); } });
  const cyclic: unknown[] = []; cyclic.push(cyclic);
  const invalid = [undefined, NaN, Infinity, -Infinity, 1n, () => 1, Symbol("x"), new Date(), new Map(), getter, cyclic, [undefined], { toJSON: () => 1 }];
  for (const value of invalid) assert.equal(boundToolJson(value), undefined);
  assert.equal(read, 0);
  const input = Object.defineProperty({ ...base, kind: "json" }, "value", { get() { read++; return {}; } });
  assert.equal(parseToolPresentation(input), undefined);
  assert.equal(read, 0);
  const { proxy, revoke } = Proxy.revocable({}, {}); revoke();
  assert.equal(boundToolJson(proxy), undefined);
  assert.equal(parseToolPresentation(proxy), undefined);
});

test("可选 undefined 对象字段省略，不丢失常规 TS 工具结果", () => {
  const data = { empty: undefined, nested: { model: undefined, sandboxMode: undefined, id: "t1" }, keep: null };
  assert.deepEqual(plain(boundToolJson(data)?.value), { nested: { id: "t1" }, keep: null });
  assert.equal(boundToolJson(data)?.truncated, false);
  const discovery = parseToolPresentation({ ...base, kind: "discovery", query: undefined, tools: [{ name: "search", description: undefined }] });
  assert.deepEqual(plain(discovery), { ...base, kind: "discovery", tools: [{ name: "search" }] });
  const schedule = parseToolPresentation({ ...base, kind: "schedule", operation: "list", tasks: [data.nested], runs: [] });
  assert.deepEqual(plain(schedule), { ...base, kind: "schedule", operation: "list", tasks: [{ id: "t1" }], runs: [] });
  const shell = parseToolPresentation({ ...base, kind: "shell", operation: "read", shell: { id: "bg-1", status: undefined } });
  assert.deepEqual(plain(shell), { ...base, kind: "shell", operation: "read", shell: { id: "bg-1" } });
  assert.equal(boundToolJson(undefined), undefined);
  assert.equal(boundToolJson([undefined]), undefined);
  assert.equal(boundToolJson({ callback: () => 1 }), undefined);
  for (const status of ["running", "exited", "failed", "killed", "timed_out"]) assert.ok(parseToolPresentation({ ...base, kind: "shell", operation: "read", shell: { id: "bg-1", status } }));
  for (const status of ["cancelled", "constructor", "__proto__", "success", "error"]) assert.equal(parseToolPresentation({ ...base, kind: "shell", operation: "read", shell: { id: "bg-1", status } }), undefined);
});

test("删除 prototype keys，不透传未知身份字段，保留普通文本为数据", () => {
  const malicious = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"prototype":{},"safe":{"text":"<script>run()</script>"}}');
  const result = boundToolJson(malicious);
  assert.deepEqual(plain(result?.value), { safe: { text: "<script>run()</script>" } });
  assert.equal(({} as { polluted?: unknown }).polluted, undefined);
  const shell = parseToolPresentation({ ...base, kind: "shell", operation: "read", secret: "not retained", shell: { id: "bg-1", auth: "not retained" } });
  assert.deepEqual(plain(shell), { ...base, kind: "shell", operation: "read", shell: { id: "bg-1" } });
  const memory = parseToolPresentation({ ...base, kind: "memory", operation: "read", entries: [{ scope: "global", privateField: "not retained" }] });
  assert.deepEqual(plain(memory), { ...base, kind: "memory", operation: "read", entries: [{ scope: "global" }] });
});

test("80k 序列化字符预算包含转义、容器和明确的截断占位", () => {
  const inputs: unknown[] = ["x".repeat(100_000), "\n\"\\".repeat(100_000), { first: "x".repeat(79_970), second: "long".repeat(10_000) }, { ["k".repeat(90_000)]: 1 }, Array.from({ length: 500 }, () => "a".repeat(1_000))];
  for (const input of inputs) {
    const bounded = boundToolJson(input);
    assert.ok(bounded);
    assert.equal(bounded.truncated, true);
    const serialized = JSON.stringify(bounded.value);
    assert.ok(serialized.length <= 80_000, `${serialized.length} chars`);
    assert.match(serialized, /\[Truncated\]/);
  }
  const parsed = parseToolPresentation({ ...base, kind: "json", value: "x".repeat(100_000) });
  assert.ok(parsed);
  assert.equal(parsed.truncated, true);
  assert.ok(JSON.stringify(parsed).length <= 80_000);
  const collisions: Record<string, JsonValue> = { $truncated: "original" };
  for (let index = 1; index < 100; index++) collisions[`$truncated${index}`] = "original";
  collisions.tail = "x".repeat(100_000);
  const collisionResult = boundToolJson(collisions);
  assert.ok(collisionResult?.truncated);
  assert.ok(JSON.stringify(collisionResult.value).length <= 80_000);
  if (collisionResult.value && !Array.isArray(collisionResult.value) && typeof collisionResult.value === "object") assert.equal(collisionResult.value.$truncated, "original");
});

test("超大 payload 省略后仍保留类型化容器和截断提示，不放宽原始损坏结构", () => {
  const huge = "x".repeat(120_000);
  const schedule = parseToolPresentation({ ...base, kind: "schedule", operation: "list", tasks: [{ id: "t1", prompt: huge }], runs: [{ id: "r1" }] });
  assert.equal(schedule?.kind, "schedule");
  assert.equal(schedule?.truncated, true);
  assert.ok(JSON.stringify(schedule).length <= 80_000);
  if (schedule?.kind === "schedule") {
    assert.ok(Array.isArray(schedule.tasks));
    assert.ok(Array.isArray(schedule.runs));
    assert.ok(schedule.runs.length === 0 || schedule.runs.every(run => run === "[Truncated]"));
    assert.match(JSON.stringify(schedule.tasks), /\[Truncated\]/);
  }
  const missingRuns = parseToolPresentation({ ...base, kind: "schedule", operation: "list", tasks: [huge], runs: [{ id: "r1" }] });
  assert.equal(missingRuns?.kind, "schedule");
  if (missingRuns?.kind === "schedule") assert.deepEqual(missingRuns.runs, []);
  assert.ok(JSON.stringify(missingRuns).length <= 80_000);
  const discovery = parseToolPresentation({ ...base, kind: "discovery", query: huge, tools: [] });
  assert.equal(discovery?.kind, "discovery");
  assert.equal(discovery?.truncated, true);
  if (discovery?.kind === "discovery") assert.deepEqual(discovery.tools, []);
  const resource = parseToolPresentation({ ...base, kind: "resource", operation: "read", server: huge, uri: "doc://a", value: { text: "retained only if budget permits" } });
  assert.equal(resource?.kind, "resource");
  assert.equal(resource?.truncated, true);
  if (resource?.kind === "resource") assert.equal(resource.value, "[Truncated]");
  assert.ok(JSON.stringify(resource).length <= 80_000);
  const largeJson = parseToolPresentation({ ...base, kind: "json", value: { [huge]: "a" } });
  assert.equal(largeJson?.kind, "json");
  assert.equal(largeJson?.truncated, true);
  for (const bad of [
    { ...base, kind: "schedule", operation: "list", tasks: [{ prompt: huge }], runs: "invalid" },
    { ...base, kind: "schedule", operation: "list", tasks: "invalid", runs: [] },
    { ...base, kind: "schedule", operation: "list", tasks: [], truncated: true },
    { ...base, kind: "discovery", query: huge, tools: "invalid" },
    { ...base, kind: "discovery", query: huge, tools: [{}] },
    { ...base, kind: "discovery", truncated: true },
    { ...base, kind: "resource", operation: "read", server: huge, value: () => "invalid" },
    { ...base, kind: "resource", operation: "read", server: huge, value: NaN },
    { ...base, kind: "resource", operation: "read", server: huge, truncated: true },
    { ...base, kind: "json", truncated: true },
    { ...base, kind: "shell", operation: "read", shell: { id: "bg-1", command: huge, status: "invented" } },
  ]) assert.equal(parseToolPresentation(bad), undefined);
});

test("depth12/node1000 截断后停止，不扫描巨数组剩余元素", () => {
  let deep: JsonValue = "leaf";
  for (let depth = 0; depth < 30; depth++) deep = { child: deep };
  const bounded = boundToolJson(deep);
  assert.ok(bounded?.truncated);
  assert.match(JSON.stringify(bounded.value), /\[Truncated\]/);
  let reads = 0;
  const giant = new Array(1_000_000).fill(1);
  Object.defineProperty(giant, "1000", { get() { reads++; throw new Error("budget exceeded"); } });
  const limited = boundToolJson(giant);
  assert.ok(limited?.truncated);
  assert.ok(Array.isArray(limited.value));
  assert.ok(limited.value.length <= 1_000);
  assert.equal(limited.value.at(-1), "[Truncated]");
  assert.equal(reads, 0);
  const countNodes = (value: JsonValue): number => 1 + (Array.isArray(value) ? value.reduce<number>((sum, item) => sum + countNodes(item), 0) : value && typeof value === "object" ? Object.values(value).reduce<number>((sum, item) => sum + countNodes(item), 0) : 0);
  const depthOf = (value: JsonValue): number => (value && typeof value === "object") ? 1 + Math.max(0, ...Object.values(value).map(depthOf)) : 0;
  assert.ok(countNodes(limited.value) <= 1_000);
  assert.ok(depthOf(bounded.value) <= 12);
  const discovery = parseToolPresentation({ ...base, kind: "discovery", tools: Array.from({ length: 1_000 }, (_, i) => ({ name: `tool${i}` })) });
  assert.equal(discovery?.kind, "discovery");
  assert.equal(discovery?.truncated, true);
  if (discovery?.kind === "discovery") assert.ok(discovery.tools.every(tool => typeof tool.name === "string"));
});

test("图片仅保留允许 MIME、规范 base64 和最多三张，独立于 JSON 文本预算", () => {
  const make = (images: unknown) => parseToolPresentation({ ...base, kind: "resource", operation: "read", value: {}, images });
  const fullSize = Buffer.alloc(2 * 1024 * 1024).toString("base64");
  const good = make([{ mimeType: "image/png", data: fullSize }]);
  assert.equal(good?.kind, "resource");
  if (good?.kind === "resource") assert.equal(good.images?.[0]?.data, fullSize);
  assert.equal(good?.truncated, undefined);
  const tiny = { mimeType: "image/webp", data: "YQ==" };
  const many = make([tiny, tiny, tiny, tiny]);
  assert.equal(many?.truncated, true);
  if (many?.kind === "resource") assert.equal(many.images?.length, 3);
  const oversized = Buffer.alloc(2 * 1024 * 1024 + 1).toString("base64");
  for (const item of [
    { mimeType: "text/html", data: "YQ==" }, { mimeType: "image/svg+xml", data: "YQ==" },
    { mimeType: "image/png", data: oversized }, { mimeType: "image/png", data: "data:image/png;base64,YQ==" },
    { mimeType: "image/png", data: "YQ==\n" }, { mimeType: "image/png", data: "YQ=" },
    { mimeType: "image/png", data: "YQ==AAAA" }, { mimeType: "image/png", data: "YR==" },
    { mimeType: "image/png", data: "YWJ=" }, { mimeType: "image/png", data: "====" },
  ]) {
    const result = make([item]);
    assert.equal(result?.truncated, true);
    if (result?.kind === "resource") assert.deepEqual(result.images, []);
  }
  assert.equal(make("bad"), undefined);
  const textAndImage = parseToolPresentation({ ...base, kind: "resource", operation: "read", value: { text: "x".repeat(100_000) }, images: [{ mimeType: "image/jpeg", data: fullSize }] });
  assert.equal(textAndImage?.truncated, true);
  assert.equal(textAndImage?.kind, "resource");
  if (textAndImage?.kind === "resource") assert.equal(textAndImage.images?.[0]?.data, fullSize);
});

test("重复对象引用允许、保留来源和已有截断状态，合法空值不被吞掉", () => {
  const shared = { a: 1 };
  assert.deepEqual(plain(boundToolJson([shared, shared])?.value), [{ a: 1 }, { a: 1 }]);
  for (const source of ["legacy", "request"] as const) {
    const result = parseToolPresentation({ version: 1, source, kind: "json", value: null, truncated: true });
    assert.deepEqual(plain(result), { version: 1, source, kind: "json", value: null, truncated: true });
  }
});
