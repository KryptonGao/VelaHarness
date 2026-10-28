export interface BrowserError {
  code: string;
  detail?: string;
}

export interface BrowserState {
  url: string;
  address: string;
  editingAddress: boolean;
  title: string;
  loading: boolean;
  ready: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  error: BrowserError | null;
  /** 元素批注模式是否开启。 */
  annotating: boolean;
}

/** Immutable snapshots for React; no DOM or Electron dependency. */
export class BrowserStore {
  private state: BrowserState = {
    url: "about:blank", address: "", editingAddress: false, title: "",
    loading: false, ready: false, canGoBack: false, canGoForward: false, error: null, annotating: false,
  };
  private readonly listeners = new Set<() => void>();

  getSnapshot = (): Readonly<BrowserState> => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  update(patch: Partial<BrowserState>): void {
    if (Object.entries(patch).every(([key, value]) => this.state[key as keyof BrowserState] === value)) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
}
