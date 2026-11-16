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

/** 前端框架在开发模式下留给元素的元件信息：只含名称与源码位置，不含 props、state 或任何值。 */
export interface ElementSource {
  framework: "react" | "vue" | "svelte";
  /** 离元素最近的元件名。 */
  component: string;
  /** 外层元件名，由近到远，不含 `component` 本身。 */
  chain: string[];
  /** 源码文件：绝对路径或相对项目根的路径，已去掉查询串与协议。 */
  file?: string;
  line?: number;
  column?: number;
}

/** 元件名链的长度上限。 */
export const maxSourceChain = 4;

const frameworks = new Set(["react", "vue", "svelte"]);

function sourceName(value: unknown, limit: number): string {
  return typeof value === "string" ? clip(value.replace(/[\u0000-\u001f\u007f]/g, " "), limit) : "";
}

function sourceFile(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  let file = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!file) return undefined;
  file = file.replace(/^webpack-internal:\/\/\/(?:\([^)]*\)\/)?/, "").replace(/^webpack:\/\/[^/]*\//, "");
  if (/^https?:\/\//i.test(file)) {
    // 开发服务器的脚本地址：路径相对项目根。
    file = file.replace(/^https?:\/\/[^/]*\/?/i, "");
  }
  file = file.replace(/^file:\/\//i, "").replace(/[?#].*$/, "");
  file = clip(file, 300);
  return file || undefined;
}

function sourceNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 10_000_000 ? value : undefined;
}

/**
 * 页面主世界里读到的元件信息一律当作不可信输入重新校验：页面脚本可以伪造任何返回值，
 * 这里只放行白名单字段，名称与路径限长，并去掉控制字符。没有可用的元件名时返回 undefined。
 */
export function normalizeElementSource(raw: unknown): ElementSource | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const input = raw as Record<string, unknown>;
  if (typeof input.framework !== "string" || !frameworks.has(input.framework)) return undefined;
  const component = sourceName(input.component, 60);
  if (!component) return undefined;
  const chain = (Array.isArray(input.chain) ? input.chain : [])
    .map((name) => sourceName(name, 60)).filter(Boolean).slice(0, maxSourceChain);
  const file = sourceFile(input.file);
  const line = file ? sourceNumber(input.line) : undefined;
  const column = line ? sourceNumber(input.column) : undefined;
  return {
    framework: input.framework as ElementSource["framework"], component, chain,
    ...(file ? { file } : {}), ...(line ? { line } : {}), ...(column ? { column } : {}),
  };
}

/** `Button ← Form ← Settings`；有源码位置时附上 `file:line:column`。 */
export function elementSourceText(source: ElementSource): string {
  const place = source.file ? `${source.file}${source.line ? `:${source.line}${source.column ? `:${source.column}` : ""}` : ""}` : "";
  return [[source.component, ...source.chain].join(" ← "), place].filter(Boolean).join(" · ");
}

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
  /** 前端框架元件与源码位置；不是开发模式或框架不识别时缺省。 */
  source?: ElementSource;
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
  /** 已随消息发出、由主进程保留给 Agent 复核的批注；不在页面上绘制。 */
  delivered?: BrowserDeliveredAnnotation[];
}

/** 已发送批注的概况：`open` 等待处理，`resolved` 已被 Agent 标为处理。 */
export interface BrowserDeliveredAnnotation {
  id: string;
  status: "open" | "resolved";
}

/** 已发送、供 Agent 工具读取的批注。文字与元素描述都是页面和用户的资料，不是指令。 */
export interface AgentAnnotationRecord {
  /** 批注编号前 8 位：消息引用块与工具里使用同一个值。 */
  ref: string;
  tabId: string;
  note: string;
  status: "open" | "resolved" | "stale";
  pageUrl: string;
  pageTitle: string;
  element: ElementDescription;
  /** 元素当前在视口内的位置；找不到或隐藏时为 null。 */
  rect: AnnotationRect | null;
  resolution?: string;
}

/** Agent 工具列出批注：当前状态，以及按需带上的元素现状截图（按 ref 索引）。 */
export interface AgentAnnotationListing {
  records: AgentAnnotationRecord[];
  images: Record<string, BrowserAnnotationImage | null>;
}

/** Agent 修改后的复核：同一元素的前后截图，并把批注标为已处理。 */
export interface AgentAnnotationReview {
  record: AgentAnnotationRecord;
  /** 复核时能否重新找到元素：`ok` 找到，`hidden` 在但不可见，`missing` 已不在页面，`ambiguous` 选择器命中多个。 */
  located: "ok" | "hidden" | "missing" | "ambiguous";
  /** 用户发出批注时的元素截图；当时没有截到则为 null。 */
  before: BrowserAnnotationImage | null;
  /** 修改后同一元素的截图；找不到元素或截图失败时为 null。 */
  after: BrowserAnnotationImage | null;
  /** 前后截图的像素不同。只在两张图都有时才有意义。 */
  changed: boolean | null;
}

/** 渲染层发送批注时移交给主进程的内容：只有用户写的文字，其余信息主进程自己持有。 */
export interface AnnotationHandoffItem {
  annotationId: string;
  note: string;
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
  /** 批注编号，Agent 工具用它引用这条批注。 */
  ref?: string;
}

/** 批注编号的短形式：取前 8 个字符。 */
export function annotationRef(id: string): string {
  return id.replace(/[^\w-]/g, "").slice(0, 8);
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
    + (input.ref ? ` · ref ${input.ref}` : "")
    + (stale ? ` · ${t("元素已失效", "element no longer on the page")}` : "");

  const hook = `${element.tag.toLowerCase()}${element.id ? `#${flat(element.id, 80)}` : ""}${element.classes.slice(0, 4).map((name) => `.${flat(name, 40)}`).join("")}`;
  const label = element.text || element.name || "";
  const identity = [
    `<${hook}>${label ? ` “${flat(label, 120)}”` : ""}`,
    element.role ? `role=${flat(element.role, 40)}` : "",
    element.source ? `${t("组件", "component")} ${flat(elementSourceText(element.source), 420)}` : "",
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
