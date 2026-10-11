import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTurnOutcome, outcomeLimits, parseOutcomeSubmission, validateOutcomeSubmission, type OutcomeSubmission, type ToolTrace } from "@vela/shared";
const edit = (id = "edit", path = "src/a.ts", diff = "-1 old\n+1 new"): ToolTrace => ({ id, name: "edit", status: "done", activity: { path, diff } });
const bash = (id = "test", status: ToolTrace["status"] = "done", body = "all tests passed"): ToolTrace => ({ id, name: "bash", status, activity: { command: "pnpm test", body } });
const draft = (files = ["src/a.ts"], verificationIds = ["test"]): OutcomeSubmission => ({ items: [{ requirement: "修复输入", status: "done", files, verificationIds, toConfirm: [] }] });
const build = (tools: ToolTrace[], submission: OutcomeSubmission | null = draft(), changedFiles?: string[]) => buildTurnOutcome({ userText: "修复输入", tools, submission, cwd: "/repo", changedFiles });
describe("deterministic turn outcome", () => {
  it("attributes only actual edits and completed bash calls with truthful counts", () => {
    const outcome = build([edit("e1", "/repo/src/a.ts"), edit("e2", "./src/a.ts", "+2 next"), bash()]);
    assert.equal(outcome.source, "agent");
    assert.deepEqual(outcome.items[0].changes, [{ path: "src/a.ts", added: 2, removed: 1, origin: "tool", diffToolIds: ["e1", "e2"] }]);
    assert.equal(outcome.items[0].evidence[0].result, "passed");
    assert.deepEqual(outcome.items[0].toConfirm, []);
  });
  it("drops fabricated paths and ids, running and non-bash ids and flags them", () => {
    const outcome = build([edit(), bash(), bash("running", "running")], draft(["invented.ts"], ["fake", "edit", "running"]));
    assert.deepEqual(outcome.items[0].changes, []);
    assert.deepEqual(outcome.items[0].evidence, []);
    assert.equal(outcome.items[0].toConfirm.filter(item => item.kind === "unattributed").length, 5);
    assert.deepEqual(outcome.unattributed.files.map(file => file.path), ["src/a.ts"]);
    assert.deepEqual(outcome.unattributed.verifications.map(item => item.toolCallId), ["test"]);
  });
  it("flags stale and failed without altering the submitted completion claim", () => {
    const outcome = build([bash("test", "error", "oops\nCommand exited with code 2"), edit()]);
    assert.equal(outcome.items[0].status, "done");
    assert.equal(outcome.items[0].evidence[0].exitCode, 2);
    assert.equal(outcome.items[0].evidence[0].stale, true);
    assert.deepEqual(outcome.items[0].toConfirm.map(item => item.kind), ["stale", "failed"]);
  });
  it("uses handoff success/exit-code semantics and ignores failed edits for staleness", () => {
    const failedEdit = { ...edit(), status: "error" as const };
    assert.equal(build([bash(), failedEdit], draft([], ["test"])).items[0].evidence[0].stale, false);
    assert.equal(build([bash("test", "done", "Command exited with code 7")], draft([], ["test"])).items[0].evidence[0].result, "failed");
  });
  it("flags missing evidence, diff, unfinished status, and carries agent concerns", () => {
    const submission = draft(["bash-made.ts"], []);
    submission.items[0].status = "partial";
    submission.items[0].toConfirm = ["需要用户确认布局"];
    const item = build([], submission, ["bash-made.ts"]).items[0];
    assert.equal(item.changes[0].origin, "disk");
    assert.deepEqual(item.toConfirm.map(item => item.kind), ["agent", "agent", "no-evidence", "no-diff"]);
  });
  it("fallback includes all facts but never infers requirement completion", () => {
    const outcome = build([edit(), bash()], null, ["subagent.ts"]);
    assert.equal(outcome.source, "derived");
    assert.equal(outcome.items[0].status, "partial");
    assert.equal(outcome.items[0].requirement, "修复输入");
    assert.equal(outcome.items[0].changes.length, 2);
    assert.equal(outcome.items[0].evidence.length, 1);
    assert.deepEqual(outcome.unattributed, { files: [], verifications: [] });
  });
  it("accepts explicitly attributed other bash commands while fallback detects validation only", () => {
    const command = { ...bash(), activity: { command: "git diff --check", body: "" } };
    assert.equal(build([command], draft([], ["test"])).items[0].evidence[0].category, "other");
    assert.equal(build([command], null).items[0].evidence.length, 0);
  });
  it("caps output tails and redacts recorded secrets", () => {
    const outcome = build([bash("test", "done", "a".repeat(1000))], draft([], ["test"]));
    assert.equal(outcome.items[0].evidence[0].outputTail.length, outcomeLimits.outputTail + 1);
  });
});
describe("submission bounds and runtime validation", () => {
  it("parses fenced JSON and tolerates missing fields and bad items", () => {
    assert.deepEqual(parseOutcomeSubmission('```json\n{"items":[null,{}, {"requirement":"  inspect  "}]}\n```'), { items: [{ requirement: "inspect", status: "not_done", files: [], verificationIds: [], toConfirm: [] }] });
    assert.equal(parseOutcomeSubmission("not json"), null);
    assert.equal(parseOutcomeSubmission({ items: [] }), null);
  });
  it("bounds item counts, strings and lists and deduplicates references", () => {
    const item = { ...draft().items[0], requirement: "a".repeat(1000), files: Array.from({ length: 100 }, (_, i) => `a${i}`), verificationIds: ["x", "x", 2], toConfirm: [" ", "ok"] };
    const parsed = parseOutcomeSubmission({ items: Array(100).fill(item), summary: "s".repeat(1000) })!;
    assert.equal(parsed.items.length, outcomeLimits.maxItems);
    assert.equal(parsed.items[0].requirement.length, outcomeLimits.itemLength);
    assert.equal(parsed.items[0].files.length, outcomeLimits.maxFiles);
    assert.deepEqual(parsed.items[0].verificationIds, ["x"]);
    assert.deepEqual(parsed.items[0].toConfirm, ["ok"]);
    assert.equal(parsed.summary!.length, outcomeLimits.itemLength);
  });
  it("validates only completed evidence admitted by the runtime map", () => {
    const evidence = new Map([["e", { name: "edit", path: "/repo/src/a.ts" }], ["test", { name: "bash" }]]);
    assert.deepEqual(validateOutcomeSubmission(draft(), evidence, "/repo"), { invalidFiles: [], invalidVerificationIds: [] });
    assert.deepEqual(validateOutcomeSubmission(draft(["fake"], ["e", "old"]), evidence, "/repo"), { invalidFiles: ["fake"], invalidVerificationIds: ["e", "old"] });
  });
});
