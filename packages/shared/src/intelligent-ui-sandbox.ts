import { uiAppHeightRange } from "./intelligent-ui";

/**
 * 沙盒微应用（IUI-14）的纯逻辑：沙盒文档、消息桥校验和 capability 发放。
 *
 * 微应用是「默认关闭、明确标识」的另一条通道，与声明式 vela-ui 完全隔离：
 * - 代码只在 `sandbox="allow-scripts"`（没有 allow-same-origin）的 iframe 里运行，origin 是不透明的，
 *   拿不到 Electron、Node、父页面的 DOM、存储或 cookie；
 * - 文档自带严格 CSP：不能联网、不能嵌套框架、不能加载外部资源；
 * - 想产生任何副作用，只能通过 postMessage 申请一个 capability，并由用户逐次确认；
 * - capability 由 Main 发放：一次性、限定大小、会过期、可撤销，且有频率限制。
 */

export const uiSandboxCapabilities = ["agent.submit", "clipboard.write"] as const;
export type UiSandboxCapability = typeof uiSandboxCapabilities[number];

export function isSandboxCapability(value: unknown): value is UiSandboxCapability {
  return typeof value === "string" && (uiSandboxCapabilities as readonly string[]).includes(value);
}

export const uiSandboxLimits = {
  /** agent.submit / clipboard.write 单次文本上限。 */
  submitChars: 2_000,
  clipboardChars: 8_000,
  /** 加载后必须在这个时间内报告 ready。 */
  readyTimeoutMs: 5_000,
  /** 心跳间隔与允许的最长静默。 */
  heartbeatMs: 1_000,
  silenceMs: 5_000,
  /** 累计错误上限，超过就停止。 */
  maxErrors: 5,
  /** 单次运行的最长时间。 */
  maxRuntimeMs: 10 * 60_000,
  /** 同时运行的微应用数量。 */
  maxRunning: 2,
  /** 每个应用每分钟最多发起的 capability 申请。 */
  requestsPerMinute: 6,
  /** capability 的有效期与同时未使用的数量。 */
  tokenTtlMs: 60_000,
  maxOutstanding: 3,
} as const;

// ---------- 沙盒文档 ----------

/** 严格 CSP：除内联脚本/样式和 data/blob 媒体外，一切资源与网络都被拒绝。 */
export const uiSandboxCsp = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "media-src data: blob:",
  "font-src data:",
  "connect-src 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "object-src 'none'",
  "worker-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

/** iframe 的 sandbox 属性：只放开脚本。没有 same-origin / forms / popups / top-navigation / modals / downloads。 */
export const uiSandboxAttribute = "allow-scripts";

const bootstrap = `(function () {
  'use strict';
  var post = function (message) { try { message.vela = 1; parent.postMessage(message, '*'); } catch (e) {} };
  // WebRTC 不受 CSP connect-src 约束：在应用代码运行前先移除。
  ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel', 'RTCSessionDescription'].forEach(function (name) {
    try { Object.defineProperty(window, name, { value: undefined, configurable: false, writable: false }); } catch (e) {}
  });
  var pending = Object.create(null);
  var next = 1;
  window.addEventListener('message', function (event) {
    var data = event.data;
    if (event.source !== parent || !data || data.vela !== 1 || data.type !== 'response') return;
    var entry = pending[data.id];
    if (!entry) return;
    delete pending[data.id];
    if (data.ok) entry.resolve(); else entry.reject(new Error(String(data.error || 'denied')));
  });
  function request(capability, text) {
    return new Promise(function (resolve, reject) {
      var id = next++;
      pending[id] = { resolve: resolve, reject: reject };
      post({ type: 'request', id: id, capability: capability, text: String(text) });
    });
  }
  Object.defineProperty(window, 'vela', {
    value: Object.freeze({
      submit: function (text) { return request('agent.submit', text); },
      copy: function (text) { return request('clipboard.write', text); }
    }),
    configurable: false
  });
  window.addEventListener('error', function (event) { post({ type: 'error', message: String(event.message || 'error').slice(0, 200) }); });
  window.addEventListener('unhandledrejection', function (event) {
    var reason = event.reason;
    post({ type: 'error', message: String((reason && reason.message) || reason || 'rejection').slice(0, 200) });
  });
  var last = 0;
  function report() {
    var body = document.body;
    var root = document.documentElement;
    var height = Math.ceil(Math.max(body ? body.scrollHeight : 0, root ? root.scrollHeight : 0));
    if (height !== last) { last = height; post({ type: 'resize', height: height }); }
  }
  window.addEventListener('load', function () { post({ type: 'ready' }); report(); });
  setInterval(function () { post({ type: 'heartbeat' }); report(); }, ${uiSandboxLimits.heartbeatMs});
})();`;

const baseStyle = `:root { color-scheme: light dark; }
html, body { margin: 0; padding: 0; }
body { padding: 8px; font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; overflow-wrap: anywhere; }`;

/**
 * 把模型给的 HTML 正文包进沙盒文档。CSP 与启动脚本在模型内容之前，
 * 所以模型的脚本无法在策略生效前运行。正文里自带的 CSP meta 只会让策略更严（多条策略取交集）。
 */
export function buildSandboxDocument(source: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">`
    + `<meta http-equiv="Content-Security-Policy" content="${uiSandboxCsp}">`
    + `<meta name="viewport" content="width=device-width, initial-scale=1">`
    + `<style>${baseStyle}</style><script>${bootstrap}</script></head><body>${source}</body></html>`;
}

// ---------- 消息桥 ----------

export type SandboxMessage =
  | { type: "ready" }
  | { type: "heartbeat" }
  | { type: "resize"; height: number }
  | { type: "error"; message: string }
  | { type: "request"; id: number; capability: UiSandboxCapability; text: string };

/** iframe 发来的消息是不可信输入：只接受已知类型，数值限幅，文本限长。 */
export function parseSandboxMessage(data: unknown): SandboxMessage | null {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  if (record.vela !== 1) return null;
  switch (record.type) {
    case "ready": return { type: "ready" };
    case "heartbeat": return { type: "heartbeat" };
    case "resize": {
      if (typeof record.height !== "number" || !Number.isFinite(record.height)) return null;
      return { type: "resize", height: Math.round(Math.min(Math.max(record.height, uiAppHeightRange.min), uiAppHeightRange.max)) };
    }
    case "error":
      return { type: "error", message: typeof record.message === "string" ? record.message.slice(0, 200) : "error" };
    case "request": {
      if (typeof record.id !== "number" || !Number.isInteger(record.id) || record.id < 1 || record.id > 1_000_000) return null;
      if (!isSandboxCapability(record.capability) || typeof record.text !== "string" || record.text.length === 0) return null;
      const limit = record.capability === "agent.submit" ? uiSandboxLimits.submitChars : uiSandboxLimits.clipboardChars;
      if (record.text.length > limit) return null;
      return { type: "request", id: record.id, capability: record.capability, text: record.text };
    }
    default: return null;
  }
}

export type SandboxStopReason = "stopped" | "unresponsive" | "errors" | "timeout" | "limit" | "disposed";

// ---------- capability 发放（Main） ----------

export type UiSandboxIssueResult =
  | { ok: true; token: string; expiresAt: number }
  | { ok: false; error: CapabilityDenied };

export type CapabilityDenied = "bad_capability" | "rate_limited" | "too_many" | "too_large";
export type CapabilityRejected = "unknown" | "expired" | "mismatch" | "scope";

interface Grant {
  appKey: string;
  capability: UiSandboxCapability;
  maxChars: number;
  expiresAt: number;
}

export interface CapabilityBrokerOptions {
  now?: () => number;
  token?: () => string;
}

function defaultToken(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  throw new Error("secure random is unavailable");
}

/**
 * 一次性、限定范围、会过期、可撤销的 capability。
 * 令牌只在 Main 与发起用户确认的渲染层之间流转，iframe 永远拿不到。
 */
export class SandboxCapabilityBroker {
  private readonly grants = new Map<string, Grant>();
  private readonly issued = new Map<string, number[]>();
  private readonly now: () => number;
  private readonly makeToken: () => string;

  constructor(options: CapabilityBrokerOptions = {}) {
    this.now = options.now ?? Date.now;
    this.makeToken = options.token ?? defaultToken;
  }

  issue(appKey: string, capability: unknown, size: number): { ok: true; token: string; expiresAt: number } | { ok: false; error: CapabilityDenied } {
    if (!isSandboxCapability(capability) || typeof appKey !== "string" || appKey.length === 0 || appKey.length > 300) return { ok: false, error: "bad_capability" };
    const limit = capability === "agent.submit" ? uiSandboxLimits.submitChars : uiSandboxLimits.clipboardChars;
    if (!Number.isInteger(size) || size < 1 || size > limit) return { ok: false, error: "too_large" };
    const now = this.now();
    this.sweep(now);
    const recent = (this.issued.get(appKey) ?? []).filter(time => now - time < 60_000);
    if (recent.length >= uiSandboxLimits.requestsPerMinute) { this.issued.set(appKey, recent); return { ok: false, error: "rate_limited" }; }
    const outstanding = [...this.grants.values()].filter(grant => grant.appKey === appKey).length;
    if (outstanding >= uiSandboxLimits.maxOutstanding) return { ok: false, error: "too_many" };
    recent.push(now);
    this.issued.set(appKey, recent);
    const token = this.makeToken();
    const expiresAt = now + uiSandboxLimits.tokenTtlMs;
    this.grants.set(token, { appKey, capability, maxChars: size, expiresAt });
    return { ok: true, token, expiresAt };
  }

  /** 兑换：令牌立即作废（一次性）。应用、capability 和文本大小必须与发放时一致。 */
  redeem(token: string, appKey: string, capability: unknown, size: number): { ok: true } | { ok: false; error: CapabilityRejected } {
    const grant = typeof token === "string" ? this.grants.get(token) : undefined;
    if (!grant) return { ok: false, error: "unknown" };
    this.grants.delete(token);
    if (this.now() > grant.expiresAt) return { ok: false, error: "expired" };
    if (grant.appKey !== appKey || grant.capability !== capability) return { ok: false, error: "mismatch" };
    if (!Number.isInteger(size) || size < 1 || size > grant.maxChars) return { ok: false, error: "scope" };
    return { ok: true };
  }

  /** 撤销某个应用的全部未使用令牌（停止、卸载、会话切换时调用）。返回撤销数量。 */
  revoke(appKey: string): number {
    let count = 0;
    for (const [token, grant] of this.grants) {
      if (grant.appKey === appKey) { this.grants.delete(token); count += 1; }
    }
    return count;
  }

  revokeAll(): void {
    this.grants.clear();
    this.issued.clear();
  }

  get outstanding(): number {
    return this.grants.size;
  }

  private sweep(now: number): void {
    for (const [token, grant] of this.grants) if (now > grant.expiresAt) this.grants.delete(token);
  }
}
