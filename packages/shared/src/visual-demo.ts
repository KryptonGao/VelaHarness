import { utf8ByteLength } from "./intelligent-ui";
import { uiSandboxCsp } from "./intelligent-ui-sandbox";

/**
 * 对话流内联可视化演示工具（Made a visual）的纯逻辑契约与沙盒文档构建。
 *
 * 与 `vela-app` 沙盒微应用不同，可视化演示面向原型草图、组件还原与架构图解：
 * - 在对话流中自动内联渲染，无需用户先点「运行」；
 * - 仍运行在 `sandbox="allow-scripts"`（无 `allow-same-origin`）+ 严格 CSP 隔离中，
 *   无法访问网络、父页面 DOM、Electron API、存储或工作区文件；
 * - 不提供 `window.vela.submit/copy` 等能力桥，仅通过 `postMessage` 上报内容高度和运行错误。
 */

export const visualToolName = "show_visual";

export const visualDemoLimits = {
  /** 单次 HTML 最大字节数（64 KiB）。 */
  maxHtmlBytes: 64 * 1024,
  /** 可选标题最大长度。 */
  maxTitleChars: 120,
  /** 内联预览容器高度范围（像素）。 */
  minHeight: 80,
  maxHeight: 720,
  defaultHeight: 240,
  /** 沙盒内脚本累计报错上限，超过后停止渲染并降级提示。 */
  maxErrors: 5,
} as const;

export interface VisualDemo {
  /** 可选标题，显示在卡片头部副标题与全屏窗口标题栏。 */
  title?: string;
  /** 自包含 HTML/CSS/SVG（及可选轻量交互脚本）片段。 */
  html: string;
  /** 建议的初始高度（像素），渲染后仍会根据实际内容自适应。 */
  height?: number;
}

export function clampVisualHeight(height: number): number {
  return Math.round(Math.min(Math.max(height, visualDemoLimits.minHeight), visualDemoLimits.maxHeight));
}

/** 校验并规范化模型或历史记录传入的 show_visual 参数；不合法时返回 null。 */
export function parseVisualDemo(raw: unknown): VisualDemo | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  if (typeof input.html !== "string") return null;
  const html = input.html.trim();
  if (!html) return null;
  if (utf8ByteLength(html) > visualDemoLimits.maxHtmlBytes) return null;

  let title: string | undefined;
  if (typeof input.title === "string") {
    const trimmed = input.title.replace(/\s+/g, " ").trim();
    if (trimmed) {
      title = trimmed.length > visualDemoLimits.maxTitleChars
        ? `${trimmed.slice(0, visualDemoLimits.maxTitleChars - 1)}…`
        : trimmed;
    }
  }

  let height: number | undefined;
  if (typeof input.height === "number" && Number.isFinite(input.height)) {
    height = clampVisualHeight(input.height);
  }

  return {
    ...(title ? { title } : {}),
    html,
    ...(height !== undefined ? { height } : {}),
  };
}

// ---------- 沙盒文档 ----------

const cssVarNameRe = /^--[a-zA-Z0-9-]+$/;
const unsafeCssValueRe = /[<>{};\\\r\n]/;

function buildThemeCss(vars: Readonly<Record<string, string>> | undefined, colorScheme?: "light" | "dark"): string {
  const declarations: string[] = [];
  if (colorScheme === "light" || colorScheme === "dark") {
    declarations.push(`color-scheme: ${colorScheme}`);
  } else {
    declarations.push("color-scheme: light dark");
  }
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      if (!cssVarNameRe.test(name) || typeof value !== "string") continue;
      const trimmed = value.trim();
      if (!trimmed || trimmed.length > 256 || unsafeCssValueRe.test(trimmed)) continue;
      declarations.push(`${name}: ${trimmed}`);
    }
  }
  return `:root { ${declarations.join("; ")}; }`;
}

const visualBootstrap = `(function () {
  'use strict';
  var post = function (message) {
    try { message.velaVisual = 1; parent.postMessage(message, '*'); } catch (e) {}
  };
  ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel', 'RTCSessionDescription'].forEach(function (name) {
    try { Object.defineProperty(window, name, { value: undefined, configurable: false, writable: false }); } catch (e) {}
  });
  window.addEventListener('error', function (event) {
    post({ type: 'error', message: String(event.message || 'error').slice(0, 200) });
  });
  window.addEventListener('unhandledrejection', function (event) {
    var reason = event.reason;
    post({ type: 'error', message: String((reason && reason.message) || reason || 'rejection').slice(0, 200) });
  });
  var last = 0;
  var raf = 0;
  function measure() {
    raf = 0;
    var body = document.body;
    var root = document.documentElement;
    var bodyHeight = body ? Math.ceil(body.getBoundingClientRect().height) : 0;
    var scrollHeight = body ? body.scrollHeight : 0;
    var rootHeight = root ? root.scrollHeight : 0;
    var height = Math.ceil(Math.max(bodyHeight, scrollHeight, rootHeight));
    if (height > 0 && height !== last) {
      last = height;
      post({ type: 'resize', height: height });
    }
  }
  function schedule() {
    if (!raf) raf = requestAnimationFrame(measure);
  }
  window.addEventListener('DOMContentLoaded', schedule);
  window.addEventListener('load', function () {
    post({ type: 'ready' });
    measure();
  });
  if (typeof ResizeObserver === 'function') {
    var ro = new ResizeObserver(schedule);
    window.addEventListener('DOMContentLoaded', function () {
      if (document.body) ro.observe(document.body);
      if (document.documentElement) ro.observe(document.documentElement);
    });
  }
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(schedule, function () {});
  }
})();`;

const visualBaseStyle = `*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: transparent; }
body {
  padding: 16px;
  font: 14px/1.5 var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
  color: var(--text-primary, inherit);
  overflow-wrap: anywhere;
}`;

export interface VisualSandboxDocumentOptions {
  /** 从宿主页采集的安全 CSS 变量表（如 --bg-card-surface、--text-primary 等）。 */
  themeVars?: Readonly<Record<string, string>>;
  colorScheme?: "light" | "dark";
}

/**
 * 把模型输出的 HTML 片段包装进严格隔离的 srcdoc 文档。
 * CSP 与引导脚本始终位于模型内容之前，保证策略最先生效。
 */
export function buildVisualSandboxDocument(html: string, options: VisualSandboxDocumentOptions = {}): string {
  const themeCss = buildThemeCss(options.themeVars, options.colorScheme);
  return `<!doctype html><html><head><meta charset="utf-8">`
    + `<meta http-equiv="Content-Security-Policy" content="${uiSandboxCsp}">`
    + `<meta name="viewport" content="width=device-width, initial-scale=1">`
    + `<style>${themeCss}\n${visualBaseStyle}</style>`
    + `<script>${visualBootstrap}</script></head><body>${html}</body></html>`;
}

// ---------- 消息桥校验 ----------

export type VisualSandboxMessage =
  | { type: "ready" }
  | { type: "resize"; height: number }
  | { type: "error"; message: string };

/** 校验来自可视化沙盒 iframe 的 postMessage，拒绝未知形状与越界高度。 */
export function parseVisualSandboxMessage(data: unknown): VisualSandboxMessage | null {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  if (record.velaVisual !== 1) return null;
  switch (record.type) {
    case "ready":
      return { type: "ready" };
    case "resize":
      if (typeof record.height !== "number" || !Number.isFinite(record.height)) return null;
      return { type: "resize", height: clampVisualHeight(record.height) };
    case "error":
      return { type: "error", message: typeof record.message === "string" ? record.message.slice(0, 200) : "error" };
    default:
      return null;
  }
}
