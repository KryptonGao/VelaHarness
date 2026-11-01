import type { BrowserTabState, BrowserUiCommand } from "@vela/shared";
import { normalizeBrowserAddress, UI_BROWSER_BLANK_URL } from "../../browser-policy";
import { BrowserStore, type BrowserError } from "./browser-store";

/** Narrow guest adapter. It deliberately exposes no scripting, CDP, or Agent bridge. */
export interface BrowserView {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
  loadURL(url: string): Promise<void>;
  getURL(): string;
  getTitle(): string;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  reload(): void;
  stop(): void;
}

/** Host-backed UI projection; the guest adapter is used only without preload. */
export class BrowserController {
  readonly store = new BrowserStore();
  private view: BrowserView | null = null;
  private detachListeners: (() => void) | null = null;
  private pendingUrl: string | null = null;
  private navigation = 0;

  constructor(private readonly host?: { tabId: string; command: (command: BrowserUiCommand) => void }) {}

  project(tab: BrowserTabState): void {
    const state = this.store.getSnapshot();
    const { url, title, loading, ready, canGoBack, canGoForward, error } = tab;
    this.store.update({ url, title, loading, ready, canGoBack, canGoForward, error, annotating: !!tab.annotation?.mode,
      ...(!state.editingAddress ? { address: url === UI_BROWSER_BLANK_URL ? "" : url } : {}) });
  }

  private send(type: "back" | "forward" | "reload" | "stop"): boolean {
    if (!this.host) return false;
    this.host.command({ type, tabId: this.host.tabId });
    return true;
  }

  /** 元素批注需要主进程的浏览器宿主。 */
  get supportsAnnotation(): boolean { return !!this.host; }

  /** 开关元素批注模式；只有应用内窗口（有主进程的浏览器宿主）支持。 */
  setAnnotating = (enabled: boolean): void => {
    this.host?.command({ type: "annotate-mode", tabId: this.host.tabId, enabled });
  };

  attach(view: BrowserView): void {
    if (this.host) return;
    if (this.view === view) return;
    this.detach();
    this.view = view;
    const listen = (type: string, handler: (event: Event) => void): (() => void) => {
      const listener: EventListener = handler;
      view.addEventListener(type, listener);
      return () => view.removeEventListener(type, listener);
    };
    const cleanups = [
      listen("dom-ready", () => {
        this.store.update({ ready: true });
        this.sync();
        if (this.pendingUrl) {
          const url = this.pendingUrl;
          this.pendingUrl = null;
          this.load(url);
        }
      }),
      listen("did-start-loading", () => this.store.update({ loading: true, error: null })),
      listen("did-stop-loading", () => { this.sync(); this.store.update({ loading: false }); }),
      listen("did-navigate", () => this.sync()),
      listen("did-navigate-in-page", () => this.sync()),
      listen("page-title-updated", () => this.sync()),
      listen("did-fail-load", (event) => {
        const failure = event as Event & { errorCode: number; errorDescription: string; isMainFrame: boolean; validatedURL?: string };
        if (!failure.isMainFrame || failure.errorCode === -3) return; // ERR_ABORTED: stop / superseded load
        this.sync();
        this.store.update({ loading: false, error: { code: "load-failed", detail: failure.errorDescription, url: failure.validatedURL || this.store.getSnapshot().url } });
      }),
      listen("render-process-gone", () => {
        this.store.update({ loading: false, error: { code: "renderer-gone" } });
      }),
    ];
    this.detachListeners = () => cleanups.forEach((cleanup) => cleanup());
  }

  detach(): void {
    if (this.host) return;
    this.navigation++;
    this.detachListeners?.();
    this.detachListeners = null;
    this.view = null;
    this.store.update({ ready: false, loading: false });
  }

  /** 改地址栏只清掉“网址无效”的提示；页面错误页要留着，直到真正发起新的导航。 */
  private withoutAddressError(): BrowserError | null {
    const { error } = this.store.getSnapshot();
    return error?.code === "invalid-address" ? null : error;
  }
  setAddress = (address: string): void => { this.store.update({ address, editingAddress: true, error: this.withoutAddressError() }); };
  beginAddressEdit = (): void => { this.store.update({ editingAddress: true }); };
  endAddressEdit = (): void => { this.store.update({ editingAddress: false }); };
  resetAddress = (): void => {
    const { url } = this.store.getSnapshot();
    this.store.update({ address: url === UI_BROWSER_BLANK_URL ? "" : url, editingAddress: false, error: this.withoutAddressError() });
  };
  navigate = (): void => {
    const url = normalizeBrowserAddress(this.store.getSnapshot().address);
    if (!url) { this.store.update({ error: { code: "invalid-address" } }); return; }
    this.store.update({ address: url, editingAddress: false, error: null });
    if (this.host) { this.host.command({ type: "goto", tabId: this.host.tabId, url }); return; }
    if (!this.view || !this.store.getSnapshot().ready) this.pendingUrl = url;
    else this.load(url);
  };
  /** 重试失败的页面：加载失败时重新请求失败的网址，页面崩溃时重新加载。 */
  retry = (): void => {
    const { error, url } = this.store.getSnapshot();
    const target = error?.code === "load-failed" ? error.url || url : null;
    if (target && target !== UI_BROWSER_BLANK_URL && normalizeBrowserAddress(target)) {
      this.store.update({ address: target, editingAddress: false, error: null });
      if (this.host) { this.host.command({ type: "goto", tabId: this.host.tabId, url: target }); return; }
      if (!this.view || !this.store.getSnapshot().ready) this.pendingUrl = target; else this.load(target);
      return;
    }
    this.store.update({ error: null });
    this.refresh();
  };
  back = (): void => {
    if (this.send("back")) return;
    if (this.store.getSnapshot().ready && this.store.getSnapshot().canGoBack) this.run((view) => view.goBack());
  };
  forward = (): void => {
    if (this.send("forward")) return;
    if (this.store.getSnapshot().ready && this.store.getSnapshot().canGoForward) this.run((view) => view.goForward());
  };
  refresh = (): void => { if (this.send("reload")) return; if (this.store.getSnapshot().ready) this.run((view) => view.reload()); };
  stop = (): void => {
    if (this.send("stop")) return;
    this.navigation++;
    this.run((view) => view.stop());
    this.store.update({ loading: false });
  };

  private run(action: (view: BrowserView) => void): void {
    if (!this.view) return;
    try { action(this.view); }
    catch (error) { this.store.update({ error: { code: "load-failed", detail: String(error) }, loading: false }); }
  }
  private load(url: string): void {
    const navigation = ++this.navigation;
    this.store.update({ loading: true, address: url, error: null });
    this.run((view) => {
      void view.loadURL(url).catch((error: unknown) => {
        if (navigation !== this.navigation || (error as { code?: string } | null)?.code === "ERR_ABORTED") return;
        if (this.store.getSnapshot().error) return; // did-fail-load 已经记下了更准确的原因
        this.store.update({ loading: false, error: { code: "load-failed", detail: String(error), url } });
      });
    });
  }
  private sync(): void {
    if (!this.view || !this.store.getSnapshot().ready) return;
    this.run((view) => {
      const url = view.getURL();
      const state = this.store.getSnapshot();
      this.store.update({
        url, title: url === UI_BROWSER_BLANK_URL ? "" : view.getTitle(),
        canGoBack: view.canGoBack(), canGoForward: view.canGoForward(),
        ...(!state.editingAddress ? { address: url === UI_BROWSER_BLANK_URL ? "" : url } : {}),
      });
    });
  }
}
