/** 元素批注：主进程取得、渲染层展示、随下一条消息发给 Agent 的元素信息与纯函数。 */

/** 单条批注文字上限。 */
export const maxAnnotationText = 2_000;
/** 一条消息最多引用的元素批注数。 */
export const maxElementAnnotations = 20;
/** 一条消息最多随附的元素截图数。 */
export const maxAnnotationImages = 4;
/** 元素描述 + 选择器 + 样式合计的字符上限。 */
export const maxElementDescription = 1_500;
/** 元素文字摘要上限。 */
export const maxElementText = 120;

export interface AnnotationRect { x: number; y: number; width: number; height: number }
export interface AnnotationViewport { width: number; height: number }

/** 主进程从页面读到的元素信息：只含白名单字段，不含输入框已填的值。 */
export interface ElementDescription {
  tag: string;
  id?: string;
  classes: string[];
  role?: string;
  /** 可访问名称。 */
  name?: string;
  /** 文字摘要，上限 120 字符。 */
  text?: string;
  selector: string;
  /** 帧路径：由外到内的 iframe 选择器，主框架内的元素为空。 */
  framePath: string[];
  /** 白名单计算样式。 */
  styles: Record<string, string>;
  /** 密码或敏感自动填充字段：文字与名称已被丢弃。 */
  sensitive: boolean;
}

/** 点选后等待用户写批注的元素。 */
export interface BrowserAnnotationPick {
  id: string;
  element: ElementDescription;
  rect: AnnotationRect | null;
  viewport: AnnotationViewport;
  canParent: boolean;
  canChild: boolean;
}

export type AnnotationTrackStatus = "ok" | "hidden" | "stale";
export type AnnotationShotState = "pending" | "ok" | "failed";

/** 已创建批注的元素当前位置，页面滚动、缩放后由主进程更新。 */
export interface BrowserAnnotationTrack {
  id: string;
  status: AnnotationTrackStatus;
  rect: AnnotationRect | null;
  viewport: AnnotationViewport;
  shot: AnnotationShotState;
}

export interface BrowserTabAnnotation {
  /** 批注模式是否开启。 */
  mode: boolean;
  /** 拾取失败时的一次性提示；`nonce` 变化表示新的一次。 */
  notice: { code: "pick-failed"; nonce: number } | null;
  pick: BrowserAnnotationPick | null;
  items: BrowserAnnotationTrack[];
}

/** 元素裁切图，坐标单位都是 CSS 像素。 */
export interface BrowserAnnotationImage {
  data: string;
  mimeType: "image/png";
  width: number;
  height: number;
  clipWidth: number;
  clipHeight: number;
  /** 裁切区域内需要打码的密码框，相对裁切区域左上角。 */
  masks: AnnotationRect[];
  /** 元素比可见区域大，只截到了可见部分。 */
  cropped: boolean;
}

/** 渲染层保存的元素批注：随卡片一起存在，发送时组成引用块。 */
export interface ElementAnnotationData {
  pageUrl: string;
  pageTitle: string;
  element: ElementDescription;
  rect: AnnotationRect | null;
  viewport: AnnotationViewport;
}

// 本包不引入 DOM 或 Node 类型；WHATWG URL 在主进程与渲染层都可用。
declare class URL {
  constructor(input: string);
  readonly protocol: string;
  readonly origin: string;
  readonly pathname: string;
  readonly searchParams: Iterable<[string, string]>;
}

const tokenWords = new Set([
  "token", "key", "secret", "password", "passwd", "pwd", "code", "auth", "authorization",
  "session", "sid", "sig", "signature", "credential", "credentials", "apikey", "jwt", "bearer",
]);

function paramWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function isTokenParam(name: string): boolean {
  const words = paramWords(name);
  return words.some((word) => tokenWords.has(word)) || tokenWords.has(words.join(""));
}

/** 引用页面地址：保留 origin 与路径，令牌类参数的值替换为 `…`，去掉账号信息和 # 片段。 */
export function redactUrl(raw: string): string {
  let url: URL;
  try { url = new URL(raw); } catch { return raw.replace(/\s+/g, " ").trim(); }
  if (url.protocol !== "http:" && url.protocol !== "https:") return `${url.protocol}//…`;
  const params: string[] = [];
  for (const [name, value] of url.searchParams) {
    params.push(`${encodeURIComponent(name)}=${isTokenParam(name) ? "…" : encodeURIComponent(value)}`);
  }
  return `${url.origin}${url.pathname}${params.length ? `?${params.join("&")}` : ""}`;
}

/** 敏感类别的 `autocomplete` 词元：密码、一次性验证码、银行卡信息。主进程把这段正则带进页面里判断。 */
export const sensitiveAutocompleteSource = "^(current-password|new-password|one-time-code|cc-[a-z-]+)$";

/** 密码框，或带敏感类别 `autocomplete` 的字段：值永不读取，截图时打码。 */
export function isSensitiveField(input: { type?: string | null; autocomplete?: string | null }): boolean {
  if ((input.type ?? "").toLowerCase() === "password") return true;
  const pattern = new RegExp(sensitiveAutocompleteSource);
  return (input.autocomplete ?? "").toLowerCase().split(/\s+/).some((token) => pattern.test(token));
}

function clip(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1).trimEnd()}…` : flat;
}

/** 卡片上的元素简述，如 `button.primary「提交」`。 */
export function elementSummary(element: ElementDescription): string {
  const tag = element.tag.toLowerCase();
  const hook = element.id ? `#${element.id}` : element.classes[0] ? `.${element.classes[0]}` : "";
  const label = clip(element.text || element.name || "", 24);
  return `${tag}${hook}${label ? `「${label}」` : ""}`;
}

/** 失效判定：页面已换过文档，或者元素已从文档中移除。 */
export function classifyAnnotationBox(input: {
  generation: number;
  currentGeneration: number;
  box: { rect: AnnotationRect } | { error: "gone" | "hidden" };
}): { status: AnnotationTrackStatus; rect: AnnotationRect | null } {
  if (input.generation !== input.currentGeneration) return { status: "stale", rect: null };
  if ("error" in input.box) return { status: input.box.error === "gone" ? "stale" : "hidden", rect: null };
  const { rect } = input.box;
  if (!(rect.width > 0 && rect.height > 0)) return { status: "hidden", rect: null };
  return { status: "ok", rect };
}

/** 标记是否在页面可见区域内；移出视口时隐藏。 */
export function annotationInViewport(rect: AnnotationRect, viewport: AnnotationViewport): boolean {
  return rect.x < viewport.width && rect.y < viewport.height && rect.x + rect.width > 0 && rect.y + rect.height > 0;
}

export type AnnotationImageRef = number | "omitted" | "failed" | null;

export interface ElementReferenceInput {
  /** 在本条消息里的批注序号，从 1 开始。 */
  number: number;
  data: ElementAnnotationData;
  stale: boolean;
  image: AnnotationImageRef;
  /** 截图只含元素的可见部分。 */
  cropped?: boolean;
}

type Translate = (chinese: string, english: string) => string;

function px(value: number): string {
  return String(Math.round(value));
}

/**
 * 元素引用块：Markdown 引用，三行。里面的文字都是页面的资料而不是指令，
 * 所以统一压成单行，不使用引用之外的标记。
 */
export function elementReferenceBlock(input: ElementReferenceInput, t: Translate): string {
  const { number, data, stale } = input;
  const element = data.element;
  const flat = (value: string, limit = 400) => clip(value, limit);
  const title = flat(data.pageTitle, 120);
  const head = `[${t("页面批注", "Page annotation")} ${number}] ${flat(redactUrl(data.pageUrl), 300)}${title ? t(`（${title}）`, ` (${title})`) : ""}`
    + (stale ? ` · ${t("元素已失效", "element no longer on the page")}` : "");

  const hook = `${element.tag.toLowerCase()}${element.id ? `#${flat(element.id, 80)}` : ""}${element.classes.slice(0, 4).map((name) => `.${flat(name, 40)}`).join("")}`;
  const label = element.text || element.name || "";
  const identity = [
    `<${hook}>${label ? ` “${flat(label, 120)}”` : ""}`,
    element.role ? `role=${flat(element.role, 40)}` : "",
    element.selector ? `${t("选择器", "selector")} ${flat([...element.framePath, element.selector].join(" >>> "), 600)}` : "",
  ].filter(Boolean).join(" · ");

  const styles = Object.entries(element.styles).map(([name, value]) => `${name}=${flat(value, 60)}`);
  const geometry: string[] = [];
  if (data.rect) {
    geometry.push(`${t("位置", "at")} ${px(data.rect.x)}×${px(data.rect.y)}${t("，大小", ", size")} ${px(data.rect.width)}×${px(data.rect.height)}`);
  }
  const imageNote = input.image === "omitted" ? t("截图已省略", "screenshot omitted")
    : input.image === "failed" ? t("未能截图", "screenshot unavailable")
      : typeof input.image === "number" ? `${t("见图", "see image")} ${input.image}${input.cropped ? t("（已裁切）", " (cropped)") : ""}` : "";

  // 元素描述 + 选择器 + 样式合计限长，超出截断并标注；页面位置与截图提示不计入。
  let identityText = identity;
  let styleText = styles.join(" · ");
  let truncated = false;
  if (identityText.length > maxElementDescription) {
    identityText = `${identityText.slice(0, maxElementDescription - 1).trimEnd()}…`;
    truncated = true;
  }
  const room = Math.max(0, maxElementDescription - identityText.length);
  if (styleText.length > room) {
    styleText = styleText.slice(0, room).trimEnd();
    truncated = true;
  }
  const detail = [...geometry, styleText, truncated ? t("（已截断）", "(truncated)") : "", imageNote].filter(Boolean).join(" · ");
  return [head, identityText, detail].filter(Boolean).map((line) => `> ${line}`).join("\n");
}
