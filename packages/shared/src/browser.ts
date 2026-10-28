import type { BrowserAnnotationImage, BrowserTabAnnotation } from "./browser-annotation";

/** CSS viewport coordinates reported by the trusted browser input adapter. */
export interface BrowserAgentAction {
  x: number;
  y: number;
  viewportWidth: number;
  viewportHeight: number;
  kind: 'click' | 'type' | 'press' | 'select' | 'scroll';
}
export interface BrowserAgentCursor extends BrowserAgentAction {
  sequence: number;
  /** False while idle; the pointer stays mounted at its last position. */
  active?: boolean;
}
/** Trusted host state projected into the local application renderer. */
export interface BrowserTabState {
  id: string;
  conversationId: string | null;
  url: string;
  title: string;
  loading: boolean;
  ready: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  error: { code: string; detail?: string } | null;
  width: number;
  height: number;
  agentCursor?: BrowserAgentCursor | null;
  /** 元素批注：只在开启批注模式或存在批注时出现。 */
  annotation?: BrowserTabAnnotation;
}
export interface BrowserWindowState {
  tabs: BrowserTabState[];
  selected: Record<string, string>;
  activeConversationId: string | null;
  operating: string[];
  /** Incremented only for a foreground Agent open/select request. */
  focusRequest: { tabId: string; nonce: number } | null;
}
export type BrowserUiCommand =
  | { type: 'state' }
  | { type: 'activate'; conversationId: string | null }
  | { type: 'open'; id?: string; url?: string }
  | { type: 'bind'; tabId: string; guestId: number }
  | { type: 'select' | 'close' | 'back' | 'forward' | 'reload' | 'stop'; tabId: string }
  | { type: 'goto'; tabId: string; url: string }
  | { type: 'viewport'; tabId: string; width: number; height: number }
  | { type: 'annotate-mode'; tabId: string; enabled: boolean }
  | { type: 'annotate-refine'; tabId: string; pickId: string; direction: 'parent' | 'child' }
  | { type: 'annotate-cancel'; tabId: string }
  | { type: 'annotate-commit'; tabId: string; pickId: string; annotationId: string }
  | { type: 'annotate-remove'; tabId: string; annotationIds: string[] }
  | { type: 'annotate-track'; tabId: string; active: boolean };
export type BrowserAnnotationImages = Record<string, BrowserAnnotationImage | null>;
export interface BrowserPanelApi {
  command(command: BrowserUiCommand): Promise<BrowserWindowState>;
  subscribe(listener: (state: BrowserWindowState) => void): () => void;
  /** 取元素批注的截图；失败或已失效的批注为 null。 */
  annotationImages(tabId: string, annotationIds: string[]): Promise<BrowserAnnotationImages>;
}
export const BrowserIpc = { command: 'browser:command', state: 'browser:state', annotationImages: 'browser:annotation-images' } as const;
