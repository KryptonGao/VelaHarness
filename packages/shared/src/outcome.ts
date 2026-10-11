/** 成果验收契约：agent 只提交归属，修改与验证事实从本轮记录推导。 */
import type { ToolTrace } from "./index";
import type { HandoffVerificationCategory } from "./handoff";
import { diffCounts, relativePath } from "./tool-diff";
import { classifyVerification, parseExitCode } from "./verification";
import { redactSensitive } from "./redaction";

export const outcomeLimits = {
  maxItems: 30, itemLength: 500, maxFiles: 60, maxVerifications: 30,
  maxConfirmations: 30, pathLength: 1_000, idLength: 200, outputTail: 400,
} as const;
export interface OutcomeSubmission { items: OutcomeSubmissionItem[]; summary?: string }
export interface OutcomeSubmissionItem {
  requirement: string;
  status: "done" | "partial" | "not_done";
  files: string[];
  verificationIds: string[];
  toConfirm: string[];
}
export interface OutcomeChange {
  path: string; added: number; removed: number; origin: "tool" | "disk"; diffToolIds: string[];
}
export interface OutcomeEvidence {
  toolCallId: string; command: string; category: HandoffVerificationCategory;
  result: "passed" | "failed" | "unknown"; exitCode?: number; stale: boolean; outputTail: string;
}
export interface OutcomeConfirm {
  kind: "agent" | "stale" | "failed" | "no-evidence" | "no-diff" | "unattributed";
  text: string;
}
export interface OutcomeItem {
  requirement: string; status: OutcomeSubmissionItem["status"];
  changes: OutcomeChange[]; evidence: OutcomeEvidence[]; toConfirm: OutcomeConfirm[];
}
export interface TurnOutcome {
  items: OutcomeItem[];
  unattributed: { files: OutcomeChange[]; verifications: OutcomeEvidence[] };
  source: "agent" | "derived";
}
const clip = (text: string, length: number) => text.length > length ? `${text.slice(0, length - 1)}…` : text;
function strings(raw: unknown, count: number, length: number): string[] {
  return Array.isArray(raw) ? [...new Set(raw.filter((item): item is string => typeof item === "string").map(item => clip(item.trim(), length)).filter(Boolean))].slice(0, count) : [];
}
/** 接受对象、JSON 和包在 markdown code fence 内的 JSON；缺失字段安全降级。 */
export function parseOutcomeSubmission(raw: unknown): OutcomeSubmission | null {
  if (typeof raw === "string") {
    try { raw = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); }
    catch { return null; }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  if (!Array.isArray(input.items)) return null;
  const items: OutcomeSubmissionItem[] = [];
  for (const value of input.items) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const item = value as Record<string, unknown>;
    if (typeof item.requirement !== "string" || !item.requirement.trim()) continue;
    items.push({
      requirement: clip(item.requirement.trim(), outcomeLimits.itemLength),
      status: item.status === "done" || item.status === "partial" ? item.status : "not_done",
      files: strings(item.files, outcomeLimits.maxFiles, outcomeLimits.pathLength),
      verificationIds: strings(item.verificationIds, outcomeLimits.maxVerifications, outcomeLimits.idLength),
      toConfirm: strings(item.toConfirm, outcomeLimits.maxConfirmations, outcomeLimits.itemLength),
    });
    if (items.length === outcomeLimits.maxItems) break;
  }
  if (!items.length) return null;
  return { items, ...(typeof input.summary === "string" && input.summary.trim() ? { summary: clip(input.summary.trim(), outcomeLimits.itemLength) } : {}) };
}
export function validateOutcomeSubmission(
  submission: OutcomeSubmission,
  evidence: ReadonlyMap<string, { name: string; path?: string }>,
  cwd: string,
): { invalidFiles: string[]; invalidVerificationIds: string[] } {
  const paths = new Set([...evidence.values()].filter(tool => (tool.name === "edit" || tool.name === "write") && tool.path).map(tool => relativePath(tool.path!, cwd)));
  return {
    invalidFiles: [...new Set(submission.items.flatMap(item => item.files).filter(path => !paths.has(relativePath(path, cwd))))],
    invalidVerificationIds: [...new Set(submission.items.flatMap(item => item.verificationIds).filter(id => evidence.get(id)?.name !== "bash"))],
  };
}
export interface BuildTurnOutcomeInput {
  userText: string; tools: readonly ToolTrace[]; submission: OutcomeSubmission | null;
  cwd: string; changedFiles?: readonly string[];
}
export function buildTurnOutcome(input: BuildTurnOutcomeInput): TurnOutcome {
  const files = new Map<string, OutcomeChange>();
  let lastEdit = -1;
  input.tools.forEach((tool, index) => {
    if (tool.status !== "done" || (tool.name !== "edit" && tool.name !== "write")) return;
    lastEdit = index;
    if (!tool.activity.path) return;
    const path = relativePath(tool.activity.path, input.cwd);
    const current = files.get(path) ?? { path, added: 0, removed: 0, origin: "tool", diffToolIds: [] };
    if (tool.activity.diff) {
      const counts = diffCounts(tool.activity.diff);
      current.added += counts.added; current.removed += counts.removed;
      current.diffToolIds.push(tool.id);
    }
    files.set(path, current);
  });
  for (const raw of input.changedFiles ?? []) {
    const path = relativePath(raw, input.cwd);
    if (path && !files.has(path)) files.set(path, { path, added: 0, removed: 0, origin: "disk", diffToolIds: [] });
  }
  const submission = parseOutcomeSubmission(input.submission);
  const referencedIds = new Set(submission?.items.flatMap(item => item.verificationIds));
  const verifications = new Map<string, OutcomeEvidence>();
  input.tools.forEach((tool, index) => {
    if (tool.name !== "bash" || tool.status === "running" || !tool.activity.command) return;
    const category = classifyVerification(tool.activity.command) ?? (referencedIds.has(tool.id) ? "other" : null);
    if (!category) return;
    const exitCode = parseExitCode(tool.activity.body ?? "");
    const output = String(redactSensitive(tool.activity.body ?? "")).trim();
    verifications.set(tool.id, {
      toolCallId: tool.id, command: String(redactSensitive(tool.activity.command)), category,
      result: tool.status === "error" || (exitCode !== undefined && exitCode !== 0) ? "failed" : "passed",
      ...(exitCode === undefined ? {} : { exitCode }), stale: index < lastEdit,
      outputTail: output.length > outcomeLimits.outputTail ? `…${output.slice(-outcomeLimits.outputTail)}` : output,
    });
  });
  const drafts = submission?.items ?? [{
    requirement: clip(input.userText.trim() || "本轮任务", outcomeLimits.itemLength), status: "partial" as const,
    files: [...files.keys()], verificationIds: [...verifications.keys()], toConfirm: [],
  }];
  const usedFiles = new Set<string>(); const usedIds = new Set<string>();
  const items = drafts.map((draft): OutcomeItem => {
    const toConfirm: OutcomeConfirm[] = draft.toConfirm.map(text => ({ kind: "agent", text }));
    const changes: OutcomeChange[] = [];
    for (const raw of draft.files) {
      const path = relativePath(raw, input.cwd); const change = files.get(path);
      if (!change) { toConfirm.push({ kind: "unattributed", text: `未找到本轮修改：${raw}` }); continue; }
      if (!changes.includes(change)) changes.push(change);
      usedFiles.add(path);
    }
    const evidence: OutcomeEvidence[] = [];
    for (const id of draft.verificationIds) {
      const verification = verifications.get(id);
      if (!verification) { toConfirm.push({ kind: "unattributed", text: `未找到本轮已完成的验证：${id}` }); continue; }
      if (!evidence.includes(verification)) evidence.push(verification);
      usedIds.add(id);
    }
    if (draft.status !== "done") toConfirm.push({ kind: "agent", text: "需求尚未完成" });
    if (!evidence.length) toConfirm.push({ kind: "no-evidence", text: "此需求没有验证证据" });
    if (evidence.some(item => item.stale)) toConfirm.push({ kind: "stale", text: "验证之后文件又被修改，结果可能已过期" });
    if (evidence.some(item => item.result === "failed")) toConfirm.push({ kind: "failed", text: "此需求有失败的验证" });
    if (changes.some(item => !item.diffToolIds.length)) toConfirm.push({ kind: "no-diff", text: "部分修改没有可审查的工具 diff" });
    return { requirement: draft.requirement, status: draft.status, changes, evidence, toConfirm };
  });
  const unattributed = {
    files: [...files.values()].filter(file => !usedFiles.has(file.path)),
    verifications: [...verifications.values()].filter(item => !usedIds.has(item.toolCallId)),
  };
  if (unattributed.files.length || unattributed.verifications.length) {
    items[0]!.toConfirm.push({ kind: "unattributed", text: "本轮还有未归属到需求的修改或验证" });
  }
  return { items, unattributed, source: submission ? "agent" : "derived" };
}
