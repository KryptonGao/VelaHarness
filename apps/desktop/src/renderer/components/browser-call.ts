/** Browser REPL 调用的展示模型:从 JS 代码里读出「做了什么」,把输出里的截图拆出来。 */

export type BrowserStepKind =
  | "open"
  | "screenshot"
  | "click"
  | "input"
  | "snapshot"
  | "inspect"
  | "script"
  | "connect";

export interface BrowserStep {
  kind: BrowserStepKind;
  /** 步骤对象:网址、元素文字等,没有就是空串。 */
  target: string;
}

const MAX_STEPS = 3;
const MAX_TARGET = 36;

const screenshotPattern = /!\[Browser screenshot\]\((data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+)\)/g;

/** 把截图图片从 Markdown 输出里抽出来,剩下的就是文字输出。 */
export function splitBrowserBody(body: string | undefined): { screenshots: string[]; output: string } {
  const text = body ?? "";
  const screenshots = [...text.matchAll(screenshotPattern)].map((match) => match[1]!);
  return { screenshots, output: text.replace(screenshotPattern, "").trim() };
}

/** 网址缩成 host + path:去掉协议、www 和末尾斜杠;解析不了就原样截断。 */
export function shortenUrl(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.protocol === "file:") return decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() ?? url.pathname);
    const path = `${url.pathname}${url.search}`.replace(/\/$/, "");
    return truncate(`${url.host.replace(/^www\./, "")}${path}`);
  } catch {
    return truncate(value.replace(/^https?:\/\//, "").replace(/\/$/, ""));
  }
}

function truncate(value: string): string {
  return value.length > MAX_TARGET ? `${value.slice(0, MAX_TARGET - 1)}…` : value;
}

/** 抓第一个引号里的参数:'x'、"x"、`x`。 */
const quoted = String.raw`\(\s*(?:\{[^)]*?(?:url|text|name)\s*:\s*)?['"\`]([^'"\`]+)['"\`]`;

/**
 * 按出现顺序归纳代码里的浏览器动作,最多 MAX_STEPS 条,同类动作合并。
 * 没有识别到任何动作时返回一条 script;只有取得浏览器/列标签页的代码返回 connect。
 */
export function summarizeBrowserCode(code: string | undefined): BrowserStep[] {
  const source = code ?? "";
  const found: { index: number; step: BrowserStep }[] = [];
  const add = (pattern: RegExp, kind: BrowserStepKind, target?: (match: RegExpExecArray) => string) => {
    for (const match of source.matchAll(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`))) {
      found.push({ index: match.index ?? 0, step: { kind, target: target?.(match as RegExpExecArray) ?? "" } });
    }
  };

  add(new RegExp(String.raw`\.(?:goto|navigate|open|newTab)${quoted}`), "open", (match) => shortenUrl(match[1] ?? ""));
  add(/\.(?:goto|navigate|reload|back|forward)\s*\(/, "open");
  add(/\.screenshot\s*\(/, "screenshot");
  add(new RegExp(String.raw`\.click${quoted}`), "click", (match) => truncate(match[1] ?? ""));
  add(/\.(?:click|dblclick|hover)\s*\(/, "click");
  add(/\.(?:fill|type|press|selectOption|check|uncheck)\s*\(/, "input");
  add(/\.snapshot\s*\(/, "snapshot");
  add(/\.(?:console|network|evaluate|eval|content|text)\s*\(/, "inspect");

  // 带参数的匹配会和无参数的重复,同位置只保留信息更多的那条。
  found.sort((a, b) => a.index - b.index);
  const steps: BrowserStep[] = [];
  let lastKind: BrowserStepKind | null = null;
  for (const { step } of dedupeByKind(found)) {
    if (step.kind === lastKind) {
      const last = steps[steps.length - 1]!;
      if (!last.target && step.target) last.target = step.target;
      continue;
    }
    steps.push({ ...step });
    lastKind = step.kind;
  }
  if (steps.length > 0) return steps.slice(0, MAX_STEPS);
  if (/agent\.browsers\.get|tabs\.(?:list|selected)/.test(source)) return [{ kind: "connect", target: "" }];
  return [{ kind: "script", target: "" }];
}

/** 同一个调用位置匹配到多条(有参 + 无参)时,保留有 target 的那条。 */
function dedupeByKind(found: { index: number; step: BrowserStep }[]): { index: number; step: BrowserStep }[] {
  const out: { index: number; step: BrowserStep }[] = [];
  for (const item of found) {
    const previous = out[out.length - 1];
    if (previous && previous.step.kind === item.step.kind && item.index - previous.index <= 24) {
      if (!previous.step.target && item.step.target) previous.step = item.step;
      continue;
    }
    out.push({ ...item, step: { ...item.step } });
  }
  return out;
}

/** 代码里最近一次 goto 的网址,给截图画面的地址栏用。 */
export function lastBrowserUrl(code: string | undefined): string {
  const matches = [...(code ?? "").matchAll(new RegExp(String.raw`\.(?:goto|navigate|open|newTab)\s*\(\s*['"\`]([^'"\`]+)['"\`]`, "g"))];
  return matches.length > 0 ? matches[matches.length - 1]![1]!.trim() : "";
}

/** 代码里非空的第一行,当作折叠态的预览。 */
export function firstCodeLine(code: string | undefined): string {
  for (const line of (code ?? "").split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("//")) return trimmed;
  }
  return "";
}
