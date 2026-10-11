/**
 * 任务交接包的共享契约。
 * 修改文件与验证记录由 @vela/agent 从对话记录中确定性推导；
 * 目标、决策、未完成事项可由模型整理，但不能增删事实类内容。
 */
import { isAppLocale, localizeTemplate, localizeZh, type AppLocale } from "./i18n";

export const handoffLimits = {
  /** 文本区块里每一项的字符上限。 */
  itemLength: 500,
  maxDecisions: 20,
  maxUnfinished: 30,
  maxFiles: 60,
  maxVerifications: 30,
  /** 验证输出只保留尾部这么多字符。 */
  outputTail: 400,
  /** 填入输入框的最终文本上限，留出足够余量低于单条消息上限。 */
  textLength: 16_000,
} as const;

export const handoffVerificationCategories = ["test", "build", "typecheck", "lint", "other"] as const;
export type HandoffVerificationCategory = (typeof handoffVerificationCategories)[number];

export interface HandoffFile {
  /** 相对工作区的路径。 */
  path: string;
  added: number;
  removed: number;
  /** edit / write 工具调用次数；只由磁盘检测发现时为 0。 */
  edits: number;
  /** agent：工具调用回报；disk：文件检查点从磁盘上发现；both：两者都有。 */
  origin: "agent" | "disk" | "both";
}

export interface HandoffVerification {
  command: string;
  category: HandoffVerificationCategory;
  /** unknown：命令结束了，但记录里没有足够信息判断成败。 */
  result: "passed" | "failed" | "unknown";
  exitCode?: number;
  /** 这次验证之后工作区又被 edit / write 改过，结果不一定还成立。 */
  stale: boolean;
  outputTail: string;
}

export interface HandoffPack {
  conversationId: string;
  title: string;
  cwd: string;
  generatedAt: number;
  /** facts-only：没有用模型，只含记录里的事实。 */
  source: "model" | "facts-only";
  goal: string;
  decisions: string[];
  files: HandoffFile[];
  /** 因数量上限被省略的条数，预览里提示用户。 */
  omittedFiles: number;
  verifications: HandoffVerification[];
  omittedVerifications: number;
  unfinished: string[];
  /** 用户在预览里补充的说明。 */
  notes: string;
}

export interface HandoffDraftRequest {
  conversationId: string;
  locale: AppLocale;
  /** 渲染层生成的请求 id，用来取消。 */
  requestId: string;
}

export function parseHandoffDraftRequest(raw: unknown): HandoffDraftRequest {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("交接包参数不正确");
  const input = raw as Record<string, unknown>;
  if (typeof input.conversationId !== "string" || !input.conversationId.trim() || input.conversationId.length > 200) {
    throw new Error("交接包参数不正确");
  }
  if (!isAppLocale(input.locale)) throw new Error("交接包语言不正确");
  if (typeof input.requestId !== "string" || !input.requestId.trim() || input.requestId.length > 100) {
    throw new Error("交接包请求不正确");
  }
  return { conversationId: input.conversationId, locale: input.locale, requestId: input.requestId };
}

function clip(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/** 单行文本：折叠空白，避免一项内容破坏列表结构。 */
function inline(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * 把（用户编辑后的）交接包渲染成填入新对话输入框的文本。
 * 纯函数，预览和最终输出共用；超过上限时截断并注明。
 */
export function renderHandoffText(pack: HandoffPack, locale: AppLocale): string {
  const t = (zh: string, en: string, ...args: unknown[]) => localizeTemplate(locale, zh, en, ...args);
  const sections: string[] = [];
  const title = inline(pack.title);
  sections.push(`# ${t("任务交接包", "Task handoff pack")}${title ? ` · ${title}` : ""}`);
  sections.push(t(
    "以下内容整理自上一个对话，用来在新对话里接着做。文件改动和验证记录来自上一个对话的实际记录；其中的验证结果不代表当前工作区状态，依赖前请先重新确认。",
    "This was compiled from a previous conversation so you can continue the work here. File changes and verification records come from what was actually recorded there; verification results may not reflect the current workspace, so re-check before relying on them.",
  ));

  const goal = pack.goal.trim();
  sections.push(`## ${t("目标", "Goal")}\n${goal || t("（未记录）", "(not recorded)")}`);

  const decisions = pack.decisions.map(inline).filter(Boolean);
  sections.push(`## ${t("已确认决策", "Confirmed decisions")}\n${decisions.length
    ? decisions.map((item) => `- ${clip(item, handoffLimits.itemLength)}`).join("\n")
    : t("（无）", "(none)")}`);

  const files = pack.files.map((file) => {
    const counts = file.added || file.removed ? ` (+${file.added} −${file.removed})` : "";
    return `- \`${file.path}\`${counts}`;
  });
  if (pack.omittedFiles > 0) files.push(`- ${t("另有 {0} 个文件未列出", "{0} more files not listed", pack.omittedFiles)}`);
  sections.push(`## ${t("修改文件", "Modified files")}\n${files.length ? files.join("\n") : t("（无）", "(none)")}`);

  const verifications = pack.verifications.map((item) => {
    const result = item.result === "passed"
      ? t("通过", "passed")
      : item.result === "failed"
        ? t("失败", "failed")
        : t("结果不明", "result unknown");
    const code = item.exitCode === undefined ? "" : t("（退出码 {0}）", " (exit code {0})", item.exitCode);
    const stale = item.stale ? ` — ${t("之后文件又被修改，结果可能已过期", "files changed afterwards, result may be outdated")}` : "";
    return `- \`${inline(item.command)}\` — ${result}${code}${stale}`;
  });
  if (pack.omittedVerifications > 0) {
    verifications.push(`- ${t("另有 {0} 条验证未列出", "{0} more verifications not listed", pack.omittedVerifications)}`);
  }
  sections.push(`## ${t("实际验证", "Verification actually run")}\n${verifications.length
    ? verifications.join("\n")
    : t("（上一个对话没有记录任何验证）", "(no verification was recorded in the previous conversation)")}`);

  const unfinished = pack.unfinished.map(inline).filter(Boolean);
  sections.push(`## ${t("未完成事项", "Unfinished items")}\n${unfinished.length
    ? unfinished.map((item) => `- ${clip(item, handoffLimits.itemLength)}`).join("\n")
    : t("（无）", "(none)")}`);

  const notes = pack.notes.trim();
  if (notes) sections.push(`## ${t("补充说明", "Notes")}\n${notes}`);

  const text = sections.join("\n\n");
  if (text.length <= handoffLimits.textLength) return text;
  return `${text.slice(0, handoffLimits.textLength)}\n\n${t("（内容过长，已截断）", "(content too long, truncated)")}`;
}

/** 用于测试和预览标题：区块标题的本地化。 */
export function handoffSectionTitles(locale: AppLocale): Record<"goal" | "decisions" | "files" | "verifications" | "unfinished" | "notes", string> {
  return {
    goal: localizeZh(locale, "目标", "Goal"),
    decisions: localizeZh(locale, "已确认决策", "Confirmed decisions"),
    files: localizeZh(locale, "修改文件", "Modified files"),
    verifications: localizeZh(locale, "实际验证", "Verification actually run"),
    unfinished: localizeZh(locale, "未完成事项", "Unfinished items"),
    notes: localizeZh(locale, "补充说明", "Notes"),
  };
}
