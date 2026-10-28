/// <reference lib="dom" />
import { AsyncLocalStorage } from "node:async_hooks";
import type { WebContents } from "electron";
import type { BrowserAgentAction } from "../../../../packages/shared/src/browser";
import { sensitiveAutocompleteSource } from "../../../../packages/shared/src/browser-annotation";
import type { AnnotationRect, AnnotationViewport, BrowserAnnotationImage, ElementDescription } from "../../../../packages/shared/src/browser-annotation";

export class BrowserCdpError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = "BrowserCdpError"; }
  toJSON() { return { code: this.code, message: this.message }; }
}
type Frame = { id: string; parentId?: string; url: string; session?: string; context?: number };
type Entry = Record<string, any> & { cursor: number; collectedAt: number };

// Runs in an isolated world. References retain node identity, never a selector.
function domOperation(operation: string, query: any, value: any, generation: string): any {
  const w = globalThis as any;
  if (!w.__velaNodes || w.__velaGeneration !== generation) {
    w.__velaNodes = new Map(); w.__velaGeneration = generation; w.__velaNext = 0;
  }
  const nodes: Element[] = [];
  const walk = (root: Document | ShadowRoot) => {
    for (const node of Array.from(root.querySelectorAll("*"))) {
      nodes.push(node); if (node.shadowRoot) walk(node.shadowRoot);
    }
  };
  walk(document);
  const role = (n: Element) => n.getAttribute("role") || ({ BUTTON: "button", A: "link", SELECT: "combobox", TEXTAREA: "textbox" } as any)[n.tagName] || (n.tagName === "INPUT" ? ((n as HTMLInputElement).type === "checkbox" ? "checkbox" : "textbox") : "");
  const name = (n: Element) => n.getAttribute("aria-label") || (n.getAttribute("aria-labelledby") || "").split(/\s+/).map(id => document.getElementById(id)?.textContent || "").join(" ").trim() || (n as HTMLInputElement).labels?.[0]?.textContent?.trim() || n.textContent?.trim() || n.getAttribute("alt") || "";
  const ref = (n: Element) => { for (const [key, node] of w.__velaNodes) if (node === n) return key; const key = `${generation}:${++w.__velaNext}`; w.__velaNodes.set(key, n); return key; };
  if (operation === "snapshot") return { url: location.href, title: document.title, viewport: { width: innerWidth, height: innerHeight }, text: nodes.filter(n => role(n) || n.matches("input,textarea,select,[contenteditable],iframe,h1,h2,h3,p,li,label")).slice(0, 2000).map(n => `[${ref(n)}] ${role(n) || n.tagName.toLowerCase()} ${name(n).slice(0, 300)}`).join("\n") };
  let matches: Element[];
  if (query?.ref) { const n = w.__velaNodes.get(query.ref); if (!n?.isConnected || !query.ref.startsWith(`${generation}:`)) return { error: "STALE_REF" }; matches = [n]; }
  else if (query?.css) matches = nodes.filter(n => n.matches(query.css));
  else if (query?.role) matches = nodes.filter(n => role(n) === query.role && (query.name === undefined || name(n) === query.name));
  else if (typeof query?.text === "string") matches = nodes.filter(n => n.textContent?.trim() === query.text && !Array.from(n.children).some(c => c.textContent?.trim() === query.text));
  else return { error: "INVALID_QUERY" };
  if (matches.length > 1) return { error: "AMBIGUOUS_LOCATOR", count: matches.length };
  if (!matches.length) return { error: "NOT_FOUND" };
  const n = matches[0]!;
  if (operation === "read") return { value: n.matches("input,textarea") ? (n as HTMLInputElement).value : n.textContent || "" };
  if (operation === "query") return { ref: ref(n), role: role(n), name: name(n) };
  n.scrollIntoView({ block: "center", inline: "center" });
  const r = n.getBoundingClientRect(); const style = getComputedStyle(n);
  if (!r.width || !r.height || style.visibility !== "visible" || style.display === "none" || (n as HTMLInputElement).disabled || n.getAttribute("aria-disabled") === "true" || n.closest("[inert]")) return { error: "NOT_ACTIONABLE" };
  const x = r.x + r.width / 2, y = r.y + r.height / 2;
  const hit = n.getRootNode() as Document | ShadowRoot;
  const top = hit.elementFromPoint(x, y);
  if (top && top !== n && !n.contains(top)) return { error: "NOT_ACTIONABLE" };
  if (operation === "focus") {
    if ((value === "fill" || value === "type") && (!(n.matches("input,textarea,[contenteditable]")) || (n as HTMLInputElement).readOnly)) return { error: "NOT_EDITABLE" };
    (n as HTMLElement).focus();
    if (value === "fill" || value === "type") {
      if (n instanceof HTMLInputElement || n instanceof HTMLTextAreaElement) {
        if (value === "fill") n.select();
        else { try { n.setSelectionRange(n.value.length, n.value.length); } catch {} }
      } else {
        const range = document.createRange(); range.selectNodeContents(n);
        if (value === "type") range.collapse(false);
        const selection = getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
      }
    }
  }
  if (operation === "selectOption") {
    if (!(n instanceof HTMLSelectElement)) return { error: "NOT_SELECT" };
    const values = Array.isArray(value) ? value : [value];
    if (values.some(v => !Array.from(n.options).some(o => o.value === v && !o.disabled))) return { error: "INVALID_OPTION" };
    for (const option of Array.from(n.options)) option.selected = values.includes(option.value);
    n.dispatchEvent(new Event("input", { bubbles: true })); n.dispatchEvent(new Event("change", { bubbles: true }));
  }
  return { ref: ref(n), x, y, rect: [r.x, r.y, r.width, r.height] };
}


/** 点选到的节点：主会话或 OOPIF 子会话里的 backend node。 */
export interface AnnotationHit { session?: string; backendNodeId: number }
export interface AnnotationDescribed { element: ElementDescription; rect: AnnotationRect | null; viewport: AnnotationViewport; canParent: boolean; canChild: boolean }
export type AnnotationBoxResult = { rect: AnnotationRect } | { error: "gone" | "hidden" };

// 以下三个函数在隔离世界里以被点选的元素作为 this 运行：只读属性与布局，
// 不派发事件、不改 DOM，也不读取输入框已填的值。
function elementProbe(this: Element, sensitivePattern: string): any {
  const el = this;
  const win = el.ownerDocument.defaultView as Window & typeof globalThis;
  const flat = (value: string | null | undefined, limit: number) => {
    const text = (value || "").replace(/\s+/g, " ").trim();
    return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
  };
  const tag = el.tagName.toLowerCase();
  const type = tag === "input" ? ((el as HTMLInputElement).type || "").toLowerCase() : "";
  const pattern = new RegExp(sensitivePattern);
  const sensitive = type === "password" || (el.getAttribute("autocomplete") || "").toLowerCase().split(/\s+/).some(token => pattern.test(token));
  const implicit: Record<string, string> = { a: el.hasAttribute("href") ? "link" : "", button: "button", select: "combobox", textarea: "textbox", img: "img", nav: "navigation", ul: "list", ol: "list", li: "listitem", table: "table", form: "form", main: "main", header: "banner", footer: "contentinfo", h1: "heading", h2: "heading", h3: "heading", h4: "heading", h5: "heading", h6: "heading" };
  const inputRoles: Record<string, string> = { checkbox: "checkbox", radio: "radio", button: "button", submit: "button", reset: "button", range: "slider" };
  const role = el.getAttribute("role") || (tag === "input" ? inputRoles[type] || "textbox" : implicit[tag] || "");
  const root = el.getRootNode() as Document | ShadowRoot;
  const labelledBy = (el.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean).map(id => root.getElementById?.(id)?.textContent || "").join(" ");
  const labels = (el as HTMLInputElement).labels;
  const label = el.getAttribute("aria-label") || labelledBy || (labels && labels[0]?.textContent) || el.getAttribute("placeholder") || el.getAttribute("alt") || el.getAttribute("title") || "";
  const skip = ["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "SELECT", "INPUT", "OPTION", "TEMPLATE"];
  let text = "";
  const collect = (node: Node) => {
    if (text.length >= 300) return;
    if (node.nodeType === 3) { text += ` ${node.nodeValue || ""}`; return; }
    if (node.nodeType !== 1) return;
    const child = node as HTMLElement;
    if (skip.includes(child.tagName) || child.isContentEditable) return;
    for (const next of Array.from(child.childNodes)) collect(next);
  };
  if (!sensitive) collect(el);
  const summary = flat(text, 120);
  const name = flat(label || (["button", "link", "heading", "tab", "menuitem"].includes(role) ? summary : ""), 120);

  const escapeIdent = (value: string) => (win.CSS && win.CSS.escape ? win.CSS.escape(value) : value.replace(/[^a-zA-Z0-9_-]/g, "\\$&"));
  const selectorIn = (node: Element): string => {
    const scope = node.getRootNode() as Document | ShadowRoot;
    const count = (selector: string) => { try { return scope.querySelectorAll(selector).length; } catch { return 0; } };
    const matches = (candidate: Element, selector: string) => { try { return candidate.matches(selector); } catch { return false; } };
    const anchor = (candidate: Element): string => {
      const id = candidate.getAttribute("id");
      if (id && count(`#${escapeIdent(id)}`) === 1) return `#${escapeIdent(id)}`;
      for (const attr of ["data-testid", "data-test-id", "data-test", "data-cy"]) {
        const value = candidate.getAttribute(attr);
        if (!value) continue;
        const selector = `[${attr}="${value.replace(/["\\]/g, "\\$&")}"]`;
        if (count(selector) === 1) return selector;
      }
      return "";
    };
    const compound = (candidate: Element): string => {
      const classes = Array.from(candidate.classList).filter(name => /^[A-Za-z][\w-]{0,30}$/.test(name)).slice(0, 2).map(name => `.${escapeIdent(name)}`).join("");
      const base = `${candidate.tagName.toLowerCase()}${classes}`;
      const parent = candidate.parentElement;
      if (!parent) return base;
      const children = Array.from(parent.children);
      if (children.filter(child => matches(child, base)).length <= 1) return base;
      return `${base}:nth-of-type(${children.filter(child => child.tagName === candidate.tagName).indexOf(candidate) + 1})`;
    };
    const parts: string[] = [];
    for (let current: Element | null = node; current && parts.length < 8; current = current.parentElement) {
      const hook = anchor(current);
      parts.unshift(hook || compound(current));
      if (hook || count(parts.join(" > ")) === 1) break;
    }
    return parts.join(" > ");
  };
  const hops: string[] = [];
  let hopNode: Element = el;
  for (let guard = 0; guard < 6; guard++) {
    hops.unshift(selectorIn(hopNode));
    const rootNode = hopNode.getRootNode() as ShadowRoot;
    if (rootNode.nodeType === 11 && rootNode.host) hopNode = rootNode.host; else break;
  }
  const framePath: string[] = [];
  let frameWindow: Window = win;
  for (let guard = 0; guard < 6 && frameWindow !== frameWindow.top; guard++) {
    let owner: Element | null = null;
    try { owner = frameWindow.frameElement; } catch { owner = null; }
    if (!owner) break;
    framePath.unshift(selectorIn(owner));
    frameWindow = owner.ownerDocument.defaultView as Window;
  }

  const computed = win.getComputedStyle(el);
  const sides = (prefix: string) => {
    const values = ["top", "right", "bottom", "left"].map(side => computed.getPropertyValue(`${prefix}-${side}`));
    return values.every(value => value === values[0]) ? values[0]! : values.join(" ");
  };
  const color = (value: string) => {
    const match = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(value);
    if (!match || (match[4] !== undefined && Number(match[4]) < 1)) return value;
    const pairs = [match[1], match[2], match[3]].map(part => Number(part).toString(16).padStart(2, "0"));
    return `#${pairs.every(pair => pair[0] === pair[1]) ? pairs.map(pair => pair[0]).join("") : pairs.join("")}`;
  };
  const styles: Record<string, string> = {
    color: color(computed.color), "background-color": color(computed.backgroundColor), "font-size": computed.fontSize,
    "font-weight": computed.fontWeight, margin: sides("margin"), padding: sides("padding"), display: computed.display, position: computed.position,
  };
  const shadowHost = (el.getRootNode() as ShadowRoot);
  return {
    tag, id: el.getAttribute("id") || undefined, classes: Array.from(el.classList).slice(0, 6).map(name => flat(name, 40)),
    role: role || undefined, name: name || undefined, text: summary || undefined, selector: hops.join(" >>> "), framePath, styles, sensitive,
    hasParent: !!el.parentElement || (shadowHost.nodeType === 11 && !!shadowHost.host), hasChild: el.children.length > 0,
  };
}
function neighborProbe(this: Element, direction: string): Element | null {
  if (direction === "parent") {
    if (this.parentElement) return this.parentElement;
    const root = this.getRootNode() as ShadowRoot;
    return root.nodeType === 11 && root.host ? root.host : null;
  }
  const children = Array.from(this.children);
  return children.find(child => { const box = child.getBoundingClientRect(); return box.width > 0 && box.height > 0; }) ?? children[0] ?? null;
}
// 密码框与敏感自动填充字段的位置（主框架视口坐标），截图时据此打码。
function sensitiveProbe(sensitivePattern: string): number[][] {
  const pattern = new RegExp(sensitivePattern);
  const found: number[][] = [];
  const visit = (root: Document | ShadowRoot, dx: number, dy: number, depth: number) => {
    for (const node of Array.from(root.querySelectorAll("*"))) {
      if (node.shadowRoot) visit(node.shadowRoot, dx, dy, depth);
      if (node.tagName === "INPUT") {
        const input = node as HTMLInputElement;
        if (input.type.toLowerCase() !== "password" && !(input.getAttribute("autocomplete") || "").toLowerCase().split(/\s+/).some(token => pattern.test(token))) continue;
        const box = input.getBoundingClientRect();
        found.push([box.x + dx, box.y + dy, box.width, box.height]);
      } else if ((node.tagName === "IFRAME" || node.tagName === "FRAME") && depth < 3) {
        try {
          const doc = (node as HTMLIFrameElement).contentDocument;
          const box = node.getBoundingClientRect();
          if (doc) visit(doc, dx + box.x + node.clientLeft, dy + box.y + node.clientTop, depth + 1);
        } catch { /* cross-origin frames are handled through their own sessions */ }
      }
    }
  };
  visit(document, 0, 0, 0);
  return found;
}

export class BrowserCdp {
  private ready: Promise<void>;
  private invocation = new AsyncLocalStorage<AbortSignal | undefined>();
  private actionObserver = new AsyncLocalStorage<{ method: string; notify?: (action: BrowserAgentAction) => void }>();
  private checkActive() {
    if (this.dead) throw this.dead;
    if (this.invocation.getStore()?.aborted) throw new BrowserCdpError("CALL_ABORTED", "Browser invocation was cancelled");
  }
  private wait(ms: number): Promise<void> {
    this.checkActive();
    const signal = this.invocation.getStore();
    return new Promise((resolve, reject) => {
      const finish = (error?: Error) => { clearTimeout(timer); signal?.removeEventListener("abort", abort); this.pending.delete(cancel); error ? reject(error) : resolve(); };
      const abort = () => finish(new BrowserCdpError("CALL_ABORTED", "Browser invocation was cancelled"));
      const cancel = (error: Error) => finish(error);
      const timer = setTimeout(() => finish(), ms);
      this.pending.add(cancel); signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
    });
  }
  private dead?: BrowserCdpError;
  private generation = 0;
  private frames = new Map<string, Frame>();
  private logs: Entry[] = [];
  private requests: Entry[] = [];
  private cursor = 0;
  readonly collectedAt = Date.now();
  private pending = new Set<(error: Error) => void>();
  private contexts = new Map<string, number>();
  private attached = false;
  private disposed = false;
  private debuggerApi: WebContents["debugger"];
  private sessionReady = new Map<string, Promise<void>>();
  private annotationMode = false;
  private annotationListener: ((hit: AnnotationHit) => void) | null = null;
  private domReady = new Set<string>();
  private mainContexts = new Map<string, { id: number; frameId: string; session?: string }>();
  private contextKey(frameId: string, session?: string) { return JSON.stringify([session || "", frameId]); }
  constructor(private guest: WebContents) {
    this.debuggerApi = guest.debugger;
    guest.on("destroyed", this.destroyed); guest.on("render-process-gone", this.crashed);
    this.debuggerApi.on("detach", this.detached); this.debuggerApi.on("message", this.message);
    this.ready = this.initialize(); this.ready.catch(() => {});
  }
  private fail(code: string, message: string) { if (!this.dead) { this.dead = new BrowserCdpError(code, message); for (const reject of this.pending) reject(this.dead); } }
  private destroyed = () => this.fail("PAGE_DESTROYED", "Browser guest was destroyed");
  private crashed = () => this.fail("RENDERER_CRASHED", "Browser renderer crashed");
  private detached = () => this.fail("CDP_DETACHED", "Browser debugger detached");
  private async send(method: string, params: any = {}, session?: string): Promise<any> {
    this.checkActive();
    const signal = this.invocation.getStore();
    return new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); this.pending.delete(cancel); signal?.removeEventListener("abort", abort); };
      const cancel = (error: Error) => { cleanup(); reject(error); };
      const abort = () => cancel(new BrowserCdpError("CALL_ABORTED", "Browser invocation was cancelled"));
      const timer = setTimeout(() => cancel(new BrowserCdpError("CDP_TIMEOUT", `${method} timed out`)), 10000);
      this.pending.add(cancel); signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) { abort(); return; }
      (session ? this.debuggerApi.sendCommand(method, params, session) : this.debuggerApi.sendCommand(method, params)).then(result => {
        try { this.checkActive(); cleanup(); resolve(result); } catch (error) { cancel(error as Error); }
      }, error => cancel(new BrowserCdpError("CDP_ERROR", String(error.message || error))));
    });
  }
  private async enable(session?: string) {
    // Renderer focus emulation keeps CDP keyboard input usable in hidden guests.
    // This deliberately never calls WebContents.focus() or BrowserWindow.focus().
    await this.send("Emulation.setFocusEmulationEnabled", { enabled: true }, session);
    await this.send("Runtime.enable", {}, session); await this.send("Page.enable", {}, session); await this.send("Network.enable", {}, session);
    await this.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, session);
  }
  private async initialize() {
    try {
      if (this.guest.isDestroyed()) throw new BrowserCdpError("PAGE_DESTROYED", "Browser guest was destroyed");
      if (this.debuggerApi.isAttached()) throw new BrowserCdpError("CDP_ALREADY_ATTACHED", "Guest already has a debugger owner");
      this.debuggerApi.attach("1.3"); this.attached = true;
      await this.enable();
      const tree = await this.send("Page.getFrameTree");
      const visit = (t: any) => { this.frames.set(t.frame.id, { ...this.frames.get(t.frame.id), ...t.frame }); for (const child of t.childFrames || []) visit(child); }; visit(tree.frameTree);
    } catch (error) { this.fail(error instanceof BrowserCdpError ? error.code : "CDP_INIT_FAILED", String((error as Error).message)); throw this.dead; }
  }
  private record(list: Entry[], entry: Record<string, any>) { list.push({ ...entry, cursor: ++this.cursor, collectedAt: Date.now() }); if (list.length > 500) list.shift(); }
  private message = (_event: unknown, method: string, p: any, session?: string) => {
    if (this.dead) return;
    session = session || undefined;
    if (method === "Target.attachedToTarget" && p.targetInfo.type === "iframe") {
      const id = p.targetInfo.targetId; this.contexts.delete(id); this.frames.set(id, { ...this.frames.get(id), id, parentId: p.targetInfo.parentFrameId || this.frames.get(id)?.parentId || [...this.frames.values()].find(f => f.session === session && !f.parentId)?.id, url: p.targetInfo.url, session: p.sessionId });
      const ready = this.invocation.run(undefined, () => this.enable(p.sessionId));
      this.sessionReady.set(p.sessionId, ready);
      void ready.catch(() => {});
      if (this.annotationMode) void ready.then(() => this.armInspect(p.sessionId)).catch(() => {});
    } else if (method === "Target.detachedFromTarget") { for (const [id, f] of this.frames) if (f.session === p.sessionId) { this.frames.delete(id); this.contexts.delete(id); this.mainContexts.delete(this.contextKey(id, p.sessionId)); } }
    else if (method === "Page.frameAttached") {
      this.frames.set(p.frameId, { url: "", ...this.frames.get(p.frameId), id: p.frameId, parentId: p.parentFrameId, session });
    }
    else if (method === "Overlay.inspectNodeRequested") {
      if (this.annotationMode && typeof p.backendNodeId === "number") this.annotationListener?.({ session, backendNodeId: p.backendNodeId });
    }
    else if (method === "Page.frameNavigated") {
      this.generation++; this.contexts.delete(p.frame.id);
      if (this.annotationMode && !p.frame.parentId && !session) void this.armInspect(undefined).catch(() => {});
      const previous = this.frames.get(p.frame.id);
      this.mainContexts.delete(this.contextKey(p.frame.id, session));
      this.frames.set(p.frame.id, { ...previous, ...p.frame, parentId: p.frame.parentId ?? previous?.parentId, session: session ?? previous?.session });
    }
    else if (method === "Page.frameDetached") { this.frames.delete(p.frameId); this.contexts.delete(p.frameId); this.mainContexts.delete(this.contextKey(p.frameId, session)); this.generation++; }
    else if (method === "Runtime.executionContextCreated") {
      const context = p.context; const aux = context.auxData;
      if (aux?.isDefault && aux.frameId) this.mainContexts.set(this.contextKey(aux.frameId, session), { id: context.id, frameId: aux.frameId, session });
    }
    else if (method === "Runtime.executionContextDestroyed") {
      for (const [key, context] of this.mainContexts) if (context.session === session && context.id === p.executionContextId) this.mainContexts.delete(key);
    }
    else if (method === "Runtime.executionContextsCleared") {
      this.generation++;
      for (const f of this.frames.values()) if (f.session === session) this.contexts.delete(f.id);
      for (const [key, context] of this.mainContexts) if (context.session === session) this.mainContexts.delete(key);
    }
    else if (method === "Runtime.consoleAPICalled") this.record(this.logs, { type: p.type, args: p.args.map((a: any) => a.value ?? a.description), timestamp: p.timestamp, session });
    else if (method === "Runtime.exceptionThrown") this.record(this.logs, { type: "exception", message: p.exceptionDetails.exception?.description || p.exceptionDetails.text, timestamp: p.timestamp, session });
    else if (method === "Network.requestWillBeSent") this.record(this.requests, { requestId: p.requestId, session, method: p.request.method, url: p.request.url, type: p.type, startedAt: p.timestamp });
    else if (method.startsWith("Network.")) {
      const row = [...this.requests].reverse().find(r => r.requestId === p.requestId && r.session === session);
      if (!row) return;
      if (method === "Network.responseReceived") Object.assign(row, { status: p.response.status, type: p.type });
      if (method === "Network.loadingFinished" || method === "Network.loadingFailed") Object.assign(row, { duration: (p.timestamp - row.startedAt) * 1000, failure: p.errorText });
      row.cursor = ++this.cursor; row.collectedAt = Date.now();
    }
  };
  private frame(id?: string): Frame {
    const frame = id ? this.frames.get(id) : [...this.frames.values()].find(f => !f.parentId && !f.session);
    if (!frame) throw new BrowserCdpError("FRAME_NOT_FOUND", `Frame ${id || "main"} is unavailable`); return frame;
  }
  private async evaluate(expression: string, frame: Frame, mainWorld = false) {
    const generation = this.generation;
    let context = mainWorld ? this.mainContexts.get(this.contextKey(frame.id, frame.session))?.id : this.contexts.get(frame.id);
    if (mainWorld && !context) {
      const deadline = Date.now() + 3000;
      while (!context && Date.now() < deadline) {
        if (this.dead) throw this.dead;
        if (generation !== this.generation) throw new BrowserCdpError("STALE_PAGE", "Page changed while waiting for main world");
        await this.wait(25);
        context = this.mainContexts.get(this.contextKey(frame.id, frame.session))?.id;
      }
      if (!context) throw new BrowserCdpError("CONTEXT_UNAVAILABLE", "Page main-world context is unavailable");
    }
    if (!context) { const result = await this.send("Page.createIsolatedWorld", { frameId: frame.id, worldName: "vela-browser" }, frame.session); context = result.executionContextId; this.contexts.set(frame.id, context!); }
    const result = await this.send("Runtime.evaluate", { expression, contextId: context, returnByValue: true, awaitPromise: true }, frame.session);
    if (generation !== this.generation) throw new BrowserCdpError("STALE_PAGE", "Page changed during evaluation");
    if (result.exceptionDetails) throw new BrowserCdpError("EVALUATION_FAILED", result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
  private dom(op: string, query: any, value: any, frame: Frame) { return this.evaluate(`(${domOperation.toString()})(${JSON.stringify(op)},${JSON.stringify(query ?? null)},${JSON.stringify(value ?? null)},${JSON.stringify(`${frame.id}:${this.generation}`)})`, frame); }
  private async locate(op: string, query: any, value: any, frame: Frame) {
    const generation = this.generation; const deadline = Date.now() + 3000; let previous = "";
    while (true) {
      if (generation !== this.generation) throw new BrowserCdpError("STALE_PAGE", "Page navigated during operation");
      const result = await this.dom(op === "query" ? op : "check", query, null, frame);
      if (result.error && !["NOT_FOUND", "NOT_ACTIONABLE"].includes(result.error)) throw new BrowserCdpError(result.error, `Locator failed: ${result.error}`);
      const rect = JSON.stringify(result.rect);
      if (!result.error && (op === "query" || rect === previous)) return op === "focus" || op === "selectOption" ? this.dom(op, { ref: result.ref }, value, frame) : result;
      if (Date.now() >= deadline) throw new BrowserCdpError("ACTION_TIMEOUT", `Locator did not become actionable (${result.error || "unstable layout"})`);
      previous = rect; await this.wait(50); this.checkActive();
    }
  }
  async call(method: string, args: any[] = [], frameId?: string, signal?: AbortSignal, onAction?: (action: BrowserAgentAction) => void): Promise<any> {
    return this.actionObserver.run({ method, notify: onAction }, () => this.invocation.run(signal, async () => {
      this.checkActive();
      await this.awaitReady(this.ready);
      this.checkActive();
      return this.callActive(method, args, frameId);
    }));
  }
  private async reportAction(point: { x: number; y: number }, frame: Frame): Promise<void> {
    const observer = this.actionObserver.getStore();
    if (!observer?.notify) return;
    const generation = this.generation;
    try {
      let { x, y } = point;
      let child = frame;
      // Each content quad is relative to its parent's target-session root.
      // This also lifts OOPIF coordinates, while input still uses its own session.
      while (child.parentId) {
        const parent = this.frame(child.parentId);
        const viewport = await this.evaluate("({width: innerWidth, height: innerHeight})", child);
        const owner = await this.send("DOM.getFrameOwner", { frameId: child.id }, parent.session);
        const box = await this.send("DOM.getBoxModel", { backendNodeId: owner.backendNodeId }, parent.session);
        const q = box.model.content;
        if (!(viewport.width > 0 && viewport.height > 0) || q.length !== 8) return;
        if (Math.abs(q[0] + q[4] - q[2] - q[6]) > 0.5 || Math.abs(q[1] + q[5] - q[3] - q[7]) > 0.5) return;
        const u = x / viewport.width, v = y / viewport.height;
        x = q[0] + u * (q[2] - q[0]) + v * (q[6] - q[0]);
        y = q[1] + u * (q[3] - q[1]) + v * (q[7] - q[1]);
        child = parent;
        while (child.parentId && this.frame(child.parentId).session === child.session) child = this.frame(child.parentId);
      }
      const viewport = await this.evaluate("({width: innerWidth, height: innerHeight})", this.frame());
      this.checkActive();
      if (generation !== this.generation) return;
      const kind = ({ fill: "type", type: "type", selectOption: "select" } as const)[observer.method as 'fill' | 'type' | 'selectOption'] || observer.method;
      observer.notify({ x, y, viewportWidth: viewport.width, viewportHeight: viewport.height, kind: kind as BrowserAgentAction['kind'] });
    } catch {
      // Optional visual telemetry must never prevent the underlying input.
      this.checkActive();
    }
  }
  private awaitReady(ready: Promise<void>): Promise<void> {
    this.checkActive();
    const signal = this.invocation.getStore();
    return new Promise((resolve, reject) => {
      const cleanup = () => { signal?.removeEventListener("abort", abort); this.pending.delete(cancel); };
      const cancel = (error: Error) => { cleanup(); reject(error); };
      const abort = () => cancel(new BrowserCdpError("CALL_ABORTED", "Browser invocation was cancelled"));
      this.pending.add(cancel); signal?.addEventListener("abort", abort, { once: true });
      ready.then(() => { cleanup(); resolve(); }, cancel);
      if (signal?.aborted) abort();
    });
  }
  private async callActive(method: string, args: any[], frameId?: string): Promise<any> {
    this.checkActive();
    if (method === "console" || method === "network") { const options = args[0] || {}; const list = method === "console" ? this.logs : this.requests; return { collectedAt: this.collectedAt, cursor: this.cursor, entries: list.filter(e => e.cursor > (options.since || 0)).slice(-Math.max(1, Math.min(500, options.limit || 100))).map(e => ({ ...e })) }; }
    if (method === "screenshot") { const { data } = await this.send("Page.captureScreenshot", { format: "png", fromSurface: true }); const bytes = Buffer.from(data, "base64"); if (bytes.length < 24 || bytes.toString("hex", 0, 8) !== "89504e470d0a1a0a") throw new BrowserCdpError("INVALID_SCREENSHOT", "CDP returned invalid PNG"); return { data, mimeType: "image/png", width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }; }
    const frame = this.frame(frameId);
    if (frame.session) { const ready = this.sessionReady.get(frame.session); if (ready) await this.awaitReady(ready); this.checkActive(); }
    if (method === "snapshot") {
      const tree = await this.send("Page.getFrameTree");
      const visit = (t: any) => { this.frames.set(t.frame.id, { ...this.frames.get(t.frame.id), ...t.frame }); for (const child of t.childFrames || []) visit(child); }; visit(tree.frameTree);
    }
    if (method === "snapshot") return { ...await this.dom(method, null, null, frame), generation: this.generation, frameId: frame.id, frames: [...this.frames.values()].map(({ id, parentId, url }) => ({ id, parentId, url })) };
    if (method === "evaluate") { if (typeof args[0] !== "string") throw new BrowserCdpError("INVALID_ARGUMENT", "evaluate requires an expression"); return this.evaluate(args.length > 1 ? `(${args[0]})(...${JSON.stringify(Array.isArray(args[1]) ? args[1] : [args[1]])})` : args[0], frame, true); }
    if (method === "query") return this.locate(method, args[0], null, frame);
    if (method === "scroll") {
      if (this.actionObserver.getStore()?.notify) {
        const viewport = await this.evaluate("({width: innerWidth, height: innerHeight})", frame);
        await this.reportAction({ x: viewport.width / 2, y: viewport.height / 2 }, frame);
      }
      return this.evaluate(`window.scrollBy(${JSON.stringify(Number(args[0]?.x) || 0)},${JSON.stringify(Number(args[0]?.y) || 0)})`, frame);
    }
    if (method === "press") {
      if (args[0]) {
        const result = await this.locate("focus", args[0], null, frame);
        if (result.error) throw new BrowserCdpError(result.error, "Cannot focus locator");
        await this.reportAction(result, frame);
      } else if (this.actionObserver.getStore()?.notify) {
        const point = await this.evaluate("(() => { let n = document.activeElement; while(n?.shadowRoot?.activeElement) n = n.shadowRoot.activeElement; const r = n?.getBoundingClientRect(); return { x: r?.width ? r.x + r.width / 2 : innerWidth / 2, y: r?.height ? r.y + r.height / 2 : innerHeight / 2 }; })()", frame);
        await this.reportAction(point, frame);
      }
      return this.press(args[1], frame.session);
    }
    if (method === "click") {
      const point = await this.locate(method, args[0], null, frame);
      await this.reportAction(point, frame);

      // Same-process child coordinates are local; lift them through frame owners.
      let x = point.x, y = point.y, child = frame;
      while (!frame.session && child.parentId) {
        const parent = this.frame(child.parentId);
        const viewport = await this.evaluate("({width: innerWidth, height: innerHeight})", child);
        const owner = await this.send("DOM.getFrameOwner", { frameId: child.id }, parent.session);
        const box = await this.send("DOM.getBoxModel", { backendNodeId: owner.backendNodeId }, parent.session);
        const q = box.model.content;
        if (!(viewport.width > 0 && viewport.height > 0) || q.length !== 8) throw new BrowserCdpError("INVALID_FRAME_GEOMETRY", "Frame geometry unavailable");
        // Content quad maps CSS scale, rotation and skew. Reject perspective rather than misclick.
        if (Math.abs(q[0] + q[4] - q[2] - q[6]) > 0.5 || Math.abs(q[1] + q[5] - q[3] - q[7]) > 0.5) throw new BrowserCdpError("UNSUPPORTED_FRAME_TRANSFORM", "Perspective iframe transforms are unsupported");
        const u = x / viewport.width, v = y / viewport.height;
        x = q[0] + u * (q[2] - q[0]) + v * (q[6] - q[0]);
        y = q[1] + u * (q[3] - q[1]) + v * (q[7] - q[1]);
        // CDP quads are relative to the root of the target session, including same-process ancestors.
        if (!parent.session) break;
        child = parent;
        while (child.parentId && this.frame(child.parentId).session === child.session) child = this.frame(child.parentId);
      }
      await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }, frame.session); await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }, frame.session); return;
    }
    if (method === "fill" || method === "type") {
      await this.send("Emulation.setFocusEmulationEnabled", { enabled: true }, frame.session);
      await this.callActive("click", [args[0]], frame.id);
      const located = await this.locate("focus", args[0], method, frame);
      if (located.error) throw new BrowserCdpError(located.error, "Cannot edit locator");
      const query = { ref: located.ref };
      const before = await this.dom("read", query, null, frame);
      const text = String(args[1]);
      const expected = method === "fill" ? text : before.value + text;
      for (let attempt = 0; attempt < 3; attempt++) {
        this.checkActive();
        const focused = await this.dom("focus", query, method, frame);
        if (focused.error) throw new BrowserCdpError(focused.error, "Input node is unavailable");
        if (method === "fill" && !text) await this.press("Backspace", frame.session);
        else await this.send("Input.insertText", { text }, frame.session);
        await this.wait(50);
        const actual = await this.dom("read", query, null, frame);
        if (actual.error) throw new BrowserCdpError(actual.error, "Input node is unavailable");
        if (actual.value === expected) return;
        if (method === "type" && actual.value !== before.value) break;
        // Hidden renderer widgets can acknowledge their first input before focus is ready.
        await this.callActive("click", [query], frame.id);
      }
      throw new BrowserCdpError("INPUT_FAILED", "Chromium did not apply the requested text input");
    }
    if (method === "selectOption") { const result = await this.locate(method, args[0], args[1], frame); if (result.error) throw new BrowserCdpError(result.error, "Cannot select option"); await this.reportAction(result, frame); return; }
    throw new BrowserCdpError("UNSUPPORTED_METHOD", `Unsupported browser method: ${method}`);
  }

  // ---- 元素批注：拾取、描述、跟踪与截图。全部走 CDP，不向页面注入脚本、不派发页面事件。 ----
  setAnnotationListener(listener: ((hit: AnnotationHit) => void) | null): void { this.annotationListener = listener; }
  private async annotate<T>(operation: () => Promise<T>): Promise<T> {
    this.checkActive();
    await this.awaitReady(this.ready);
    return this.invocation.run(undefined, operation);
  }
  private async ensureDom(session?: string): Promise<void> {
    const key = session || "";
    if (this.domReady.has(key)) return;
    await this.send("DOM.enable", {}, session);
    this.domReady.add(key);
  }
  private async armInspect(session?: string): Promise<void> {
    if (session) { const ready = this.sessionReady.get(session); if (ready) await ready; }
    await this.ensureDom(session);
    await this.send("Overlay.enable", {}, session);
    const fill = (a: number) => ({ r: 63, g: 131, b: 235, a });
    await this.send("Overlay.setInspectMode", {
      mode: "searchForNode",
      highlightConfig: { showInfo: false, showStyles: false, showRulers: false, showAccessibilityInfo: false, showExtensionLines: false, contentColor: fill(0.22), paddingColor: fill(0.1), borderColor: fill(0.95), marginColor: { r: 0, g: 0, b: 0, a: 0 } },
    }, session);
  }
  private annotationSessions(): (string | undefined)[] {
    return [undefined, ...new Set([...this.frames.values()].map(frame => frame.session).filter((id): id is string => !!id))];
  }
  /** 进入拾取：鼠标悬停高亮元素，点击只触发拾取，页面收不到点击。 */
  async annotationStart(): Promise<void> {
    return this.annotate(async () => {
      this.annotationMode = true;
      await this.armInspect(undefined);
      for (const session of this.annotationSessions()) if (session) await this.armInspect(session).catch(() => {});
    });
  }
  async annotationStop(): Promise<void> {
    this.annotationMode = false;
    if (this.dead) return;
    try {
      await this.annotate(async () => {
        for (const session of this.annotationSessions()) {
          await this.send("Overlay.setInspectMode", { mode: "none", highlightConfig: {} }, session).catch(() => {});
          await this.send("Overlay.hideHighlight", {}, session).catch(() => {});
        }
      });
    } catch { /* the page may already be gone */ }
  }
  private annotationFrame(session?: string): Frame {
    if (!session) return this.frame();
    const frame = [...this.frames.values()].find(f => f.session === session && (!f.parentId || this.frames.get(f.parentId)?.session !== session));
    if (!frame) throw new BrowserCdpError("FRAME_NOT_FOUND", "The frame of the picked element is unavailable");
    return frame;
  }
  private async isolatedContext(frame: Frame): Promise<number> {
    let context = this.contexts.get(frame.id);
    if (!context) {
      const result = await this.send("Page.createIsolatedWorld", { frameId: frame.id, worldName: "vela-browser" }, frame.session);
      context = result.executionContextId as number; this.contexts.set(frame.id, context);
    }
    return context;
  }
  /** 在隔离世界里解析节点并以它为 this 调用函数。 */
  private async withNode<T>(hit: AnnotationHit, run: (objectId: string, session?: string) => Promise<T>): Promise<T> {
    const frame = this.annotationFrame(hit.session);
    await this.ensureDom(hit.session);
    const context = await this.isolatedContext(frame);
    let resolved: any;
    try { resolved = await this.send("DOM.resolveNode", { backendNodeId: hit.backendNodeId, executionContextId: context }, hit.session); }
    catch { throw new BrowserCdpError("ELEMENT_UNAVAILABLE", "The element is no longer available"); }
    const objectId = resolved?.object?.objectId as string | undefined;
    if (!objectId) throw new BrowserCdpError("ELEMENT_UNAVAILABLE", "The element is no longer available");
    try { return await run(objectId, hit.session); }
    finally { void this.send("Runtime.releaseObject", { objectId }, hit.session).catch(() => {}); }
  }
  private async toRoot(points: number[][], frame: Frame): Promise<number[][] | null> {
    let pts = points; let child = frame;
    while (child.parentId) {
      const parent = this.frame(child.parentId);
      const viewport = await this.evaluate("({width: innerWidth, height: innerHeight})", child);
      const owner = await this.send("DOM.getFrameOwner", { frameId: child.id }, parent.session);
      const box = await this.send("DOM.getBoxModel", { backendNodeId: owner.backendNodeId }, parent.session);
      const q = box.model.content as number[];
      if (!(viewport.width > 0 && viewport.height > 0) || q.length !== 8) return null;
      if (Math.abs(q[0]! + q[4]! - q[2]! - q[6]!) > 0.5 || Math.abs(q[1]! + q[5]! - q[3]! - q[7]!) > 0.5) return null;
      pts = pts.map(([x, y]) => {
        const u = x! / viewport.width, v = y! / viewport.height;
        return [q[0]! + u * (q[2]! - q[0]!) + v * (q[6]! - q[0]!), q[1]! + u * (q[3]! - q[1]!) + v * (q[7]! - q[1]!)];
      });
      child = parent;
      while (child.parentId && this.frame(child.parentId).session === child.session) child = this.frame(child.parentId);
    }
    return pts;
  }
  private async isConnected(hit: AnnotationHit): Promise<boolean> {
    try {
      return await this.withNode(hit, async (objectId, session) => {
        const result = await this.send("Runtime.callFunctionOn", { objectId, functionDeclaration: "function () { return this.isConnected; }", returnByValue: true }, session);
        return result.result?.value === true;
      });
    } catch { return false; }
  }
  private async boxOf(hit: AnnotationHit): Promise<AnnotationBoxResult> {
    let model: any;
    try { model = (await this.send("DOM.getBoxModel", { backendNodeId: hit.backendNodeId }, hit.session)).model; }
    catch (error) {
      const message = String((error as Error).message || "");
      // A removed node also fails to lay out: only a connected one is merely hidden.
      if (/could not compute box model/i.test(message)) return await this.isConnected(hit) ? { error: "hidden" } : { error: "gone" };
      if (/not found|no node|could not find|detached|does not belong/i.test(message)) return { error: "gone" };
      throw error;
    }
    const quad = model.border as number[];
    let points = [[quad[0]!, quad[1]!], [quad[2]!, quad[3]!], [quad[4]!, quad[5]!], [quad[6]!, quad[7]!]];
    if (hit.session) {
      const lifted = await this.toRoot(points, this.annotationFrame(hit.session)).catch(() => null);
      if (!lifted) return { error: "hidden" };
      points = lifted;
    }
    const xs = points.map(point => point[0]!), ys = points.map(point => point[1]!);
    const rect = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    return rect.width > 0 && rect.height > 0 ? { rect } : { error: "hidden" };
  }
  async annotationBox(hit: AnnotationHit): Promise<AnnotationBoxResult> { return this.annotate(() => this.boxOf(hit)); }
  async annotationDescribe(hit: AnnotationHit): Promise<AnnotationDescribed> {
    return this.annotate(async () => {
      const probe = await this.withNode(hit, async (objectId, session) => {
        const result = await this.send("Runtime.callFunctionOn", {
          objectId, functionDeclaration: elementProbe.toString(), arguments: [{ value: sensitiveAutocompleteSource }], returnByValue: true,
        }, session);
        if (result.exceptionDetails) throw new BrowserCdpError("ELEMENT_UNAVAILABLE", "The element could not be described");
        return result.result.value;
      });
      const box = await this.boxOf(hit);
      const viewport = await this.evaluate("({width: innerWidth, height: innerHeight})", this.frame());
      const { hasParent, hasChild, ...element } = probe;
      return { element: element as ElementDescription, rect: "rect" in box ? box.rect : null, viewport, canParent: !!hasParent, canChild: !!hasChild };
    });
  }
  /** 取父级或第一个可见子级；到头了返回 null。 */
  async annotationNeighbor(hit: AnnotationHit, direction: "parent" | "child"): Promise<AnnotationHit | null> {
    return this.annotate(() => this.withNode(hit, async (objectId, session) => {
      const result = await this.send("Runtime.callFunctionOn", { objectId, functionDeclaration: neighborProbe.toString(), arguments: [{ value: direction }], returnByValue: false }, session);
      if (result.exceptionDetails || !result.result?.objectId) return null;
      const neighbor = result.result.objectId as string;
      try {
        const described = await this.send("DOM.describeNode", { objectId: neighbor }, session);
        return typeof described.node?.backendNodeId === "number" ? { session, backendNodeId: described.node.backendNodeId as number } : null;
      } finally { void this.send("Runtime.releaseObject", { objectId: neighbor }, session).catch(() => {}); }
    }));
  }
  /** 元素裁切图：只截元素的可见部分，裁切区域里的密码框位置一并返回，由渲染层打码。 */
  async annotationCapture(rect: AnnotationRect, viewport: AnnotationViewport): Promise<BrowserAnnotationImage> {
    return this.annotate(async () => {
      const left = Math.max(0, rect.x), top = Math.max(0, rect.y);
      const right = Math.min(viewport.width, rect.x + rect.width), bottom = Math.min(viewport.height, rect.y + rect.height);
      const width = Math.floor(right - left), height = Math.floor(bottom - top);
      if (!(width >= 1 && height >= 1)) throw new BrowserCdpError("ELEMENT_OFFSCREEN", "The element is outside the visible area");
      const cropped = rect.x < -0.5 || rect.y < -0.5 || rect.x + rect.width > viewport.width + 0.5 || rect.y + rect.height > viewport.height + 0.5;
      const metrics = await this.send("Page.getLayoutMetrics");
      const visual = metrics.cssVisualViewport ?? metrics.visualViewport ?? {};
      const masks = await this.sensitiveRects();
      const { data } = await this.send("Page.captureScreenshot", {
        format: "png", fromSurface: true, captureBeyondViewport: false,
        clip: { x: left + (visual.pageX ?? 0), y: top + (visual.pageY ?? 0), width, height, scale: 1 },
      });
      const bytes = Buffer.from(data, "base64");
      if (bytes.length < 24 || bytes.toString("hex", 0, 8) !== "89504e470d0a1a0a") throw new BrowserCdpError("INVALID_SCREENSHOT", "CDP returned invalid PNG");
      return {
        data, mimeType: "image/png" as const, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), clipWidth: width, clipHeight: height, cropped,
        masks: masks.map(mask => ({ x: mask.x - left, y: mask.y - top, width: mask.width, height: mask.height }))
          .filter(mask => mask.x < width && mask.y < height && mask.x + mask.width > 0 && mask.y + mask.height > 0),
      };
    });
  }
  private async sensitiveRects(): Promise<AnnotationRect[]> {
    const rects: AnnotationRect[] = [];
    const frames = [this.frame(), ...[...this.frames.values()].filter(frame => frame.session && (!frame.parentId || this.frames.get(frame.parentId)?.session !== frame.session))];
    for (const frame of frames) {
      try {
        const found = await this.evaluate(`(${sensitiveProbe.toString()})(${JSON.stringify(sensitiveAutocompleteSource)})`, frame) as number[][];
        const lifted = frame.session ? await this.toRoot(found.map(([x, y]) => [x!, y!]), frame) : found.map(([x, y]) => [x!, y!]);
        if (!lifted) continue;
        found.forEach(([, , w, h], index) => rects.push({ x: lifted[index]![0]!, y: lifted[index]![1]!, width: w!, height: h! }));
      } catch { /* an unreachable frame cannot leak what it cannot show */ }
    }
    return rects;
  }
  private async press(key: string, session?: string) {
    if (typeof key !== "string") throw new BrowserCdpError("INVALID_ARGUMENT", "press requires a key");
    const parts = key.split("+"); const name = parts.pop()!; let modifiers = 0;
    for (const part of parts) { const flag = ({ Alt: 1, Control: 2, Meta: 4, Shift: 8, ControlOrMeta: process.platform === "darwin" ? 4 : 2 } as any)[part]; if (!flag) throw new BrowserCdpError("INVALID_KEY", `Unknown modifier ${part}`); modifiers |= flag; }
    const codes: Record<string, number> = { Enter: 13, Tab: 9, Escape: 27, Backspace: 8, Delete: 46, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Home: 36, End: 35, Space: 32 };
    const code = codes[name] || (name.length === 1 ? name.toUpperCase().charCodeAt(0) : 0);
    if (!code) throw new BrowserCdpError("INVALID_KEY", `Unsupported key ${name}`);
    const commands = (name.toLowerCase() === "a" && (modifiers & (process.platform === "darwin" ? 4 : 2))) ? ["selectAll"] : name === "Backspace" ? ["deleteBackward"] : undefined;
    const params = { key: name === "Space" ? " " : name, modifiers, windowsVirtualKeyCode: code };
    await this.send("Input.dispatchKeyEvent", { ...params, type: "keyDown", ...(commands ? { commands } : {}), ...(!modifiers && (name.length === 1 || name === "Enter" || name === "Space") ? { text: name === "Enter" ? "\r" : name === "Space" ? " " : name } : {}) }, session);
    await this.send("Input.dispatchKeyEvent", { ...params, type: "keyUp" }, session);
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.annotationMode = false; this.annotationListener = null;
    this.fail("CDP_DISPOSED", "Browser automation disposed");
    this.guest.removeListener("destroyed", this.destroyed); this.guest.removeListener("render-process-gone", this.crashed);
    this.debuggerApi.removeListener("message", this.message); this.debuggerApi.removeListener("detach", this.detached);
    const owned = this.attached;
    this.attached = false;
    try {
      if (owned && !this.guest.isDestroyed() && this.debuggerApi.isAttached()) this.debuggerApi.detach();
    } catch { /* guest destruction may race debugger teardown */ }
    this.frames.clear(); this.contexts.clear(); this.mainContexts.clear(); this.sessionReady.clear(); this.logs = []; this.requests = [];
  }
}
