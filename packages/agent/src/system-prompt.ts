import type { InteractionMode, SubagentKind } from "@vela/shared";

/**
 * Vela 自己的系统提示基础段，替换 Pi 的身份句、工具摘要、规则与文档导览。
 * 方案与评测口径见 docs/requirements/system-prompt-optimization.md。
 *
 * - v1：保持 Pi 默认基础段，作为对照与回退（旧名 legacy 仍可用）。
 * - v2：只换身份与规则，默认档。
 * - v2-visual：v2 加视觉成品自检、Intelligent UI 范围限定和浏览器截图提示。
 * 评测要能把「换规则」与「视觉自检」分开归因，所以两档分开。
 */
export type SystemPromptProfile = "v1" | "v2" | "v2-visual";

export const systemPromptProfiles: readonly SystemPromptProfile[] = ["v1", "v2", "v2-visual"];

export const defaultSystemPromptProfile: SystemPromptProfile = "v2";

/** 解析开关（VELA_SYSTEM_PROMPT）；legacy 是 v1 的旧名，未知值退回默认档。 */
export function systemPromptProfileFrom(value: string | undefined): SystemPromptProfile {
  const raw = value?.trim().toLowerCase();
  const normalized = raw === "legacy" ? "v1" : raw;
  return systemPromptProfiles.find(profile => profile === normalized) ?? defaultSystemPromptProfile;
}

export function usesVelaPrompt(profile: SystemPromptProfile): boolean {
  return profile !== "v1";
}

export function checksVisualWork(profile: SystemPromptProfile): boolean {
  return profile === "v2-visual";
}

export const velaPreamble =
  "You are Vela, an agent that works inside the user's workspace on a desktop app. You carry a task through to a finished, checked result using the tools provided.";

/** 主会话按当前模式取规则；子代理按类型。resident 是没有文件工具的协调会话。 */
export type RuleKind = InteractionMode | SubagentKind | "resident";

export interface RuleContext {
  kind: RuleKind;
  /** 本轮实际可用的工具名，决定 edit/write/bash 相关条目是否出现。 */
  tools: readonly string[];
  /** 当前模型能否接收图片；不能时视觉自检改为结构化检查。 */
  imageInput: boolean;
  /** 是否要求视觉成品渲染后查看（v2-visual）。 */
  visualCheck: boolean;
}

const readOnlyKinds = new Set<RuleKind>(["plan", "explore"]);

export function velaRules(context: RuleContext): string {
  const tools = new Set(context.tools);
  const readOnly = readOnlyKinds.has(context.kind);
  const canChange = !readOnly && (tools.has("edit") || tools.has("write") || tools.has("bash"));
  const rules: string[] = [];

  if (!readOnly) {
    rules.push("Finish what was asked. Do not stop at a plan or a partial result unless the user asked for a plan or the mode instructions below say otherwise.");
  }
  rules.push("Read every tool result before moving on. A non-zero exit code, an error, or an unexpectedly empty output is something to investigate, not to skip.");

  if (canChange) {
    const verify: string[] = ["Verify before you report done."];
    // Goal 模式的检查由 goalPrompt 与 record_goal_validation 负责，这里不重复要求。
    if (context.kind !== "goal" && tools.has("bash")) {
      verify.push("After changing code, run the narrowest check that covers the change (test, typecheck or build).");
    }
    if (context.visualCheck) verify.push(visualRule(tools.has("browser_repl"), context.imageInput, tools.has("bash")));
    verify.push("If you could not verify something, say exactly what you did not verify; report only checks you actually ran.");
    rules.push(verify.join(" "));
  }

  if (tools.has("read")) rules.push("Use read to examine files instead of cat or sed.");
  if (tools.has("bash") && !tools.has("grep") && !tools.has("find") && !tools.has("ls")) {
    rules.push("Use bash for file operations like ls, rg and find.");
  }
  if (!readOnly && tools.has("edit")) {
    rules.push("Read a file before you edit it. Keep edits small and exact: each edits[].oldText must match the original file exactly, be as small as possible while still unique, and not overlap another entry. Put several separate changes to one file in one edit call.");
  }
  if (!readOnly && tools.has("write")) rules.push("Use write only for new files or complete rewrites.");
  if (canChange) rules.push("Before deleting or moving anything, confirm the resolved absolute target path.");

  rules.push("If an operation is denied by a permission or sandbox policy, do not retry it another way; report it and continue with what is allowed.");
  rules.push("Keep chat replies short and plain. Do not shorten the work or the deliverable to be brief.");
  rules.push("Show file paths clearly when working with files.");

  return [
    "Working rules (mode and task instructions below take precedence when they are more specific):",
    ...rules.map(rule => `- ${rule}`),
  ].join("\n");
}

function visualRule(browser: boolean, imageInput: boolean, bash: boolean): string {
  const subject = "After producing something visual (an HTML page, SVG, chart or UI),";
  if (!imageInput) {
    return `${subject} you cannot view images with this model, so check it with executable structural checks instead (a script, console errors, DOM or attribute assertions), fix what fails, and say that you did not inspect it visually.`;
  }
  const how = browser
    ? "open it with browser_repl and emit nodeRepl.emitImage(await tab.screenshot())"
    : bash
      ? "render it to an image (for example with a headless browser through bash) and open the image with read"
      : "render it and open the image with read";
  return `${subject} render it and look at the result at least once (${how}), fix what is visibly wrong, then report.`;
}

/** Intelligent UI 说明的范围限定：只约束聊天里的围栏，不约束写入工作区的文件。 */
export const intelligentUiScopeNote =
  "Scope: this section only governs vela-ui and vela-app fences in your chat replies. HTML, JavaScript, CSS and SVG files you write to the workspace are not restricted by it.";

/** 视觉自检档在浏览器说明里补充的一句。 */
export const browserVisualCheckNote =
  "After creating or changing an HTML page or other visual output, open it here and look at it with nodeRepl.emitImage(await tab.screenshot()) before reporting it done.";
