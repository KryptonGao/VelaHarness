type Timer = ReturnType<typeof setTimeout>;

export interface StateThrottleOptions {
  intervalMs?: number;
  setTimer?: (fn: () => void, ms: number) => Timer;
  clearTimer?: (timer: Timer) => void;
}

/**
 * 工具开始/结束会连续触发，每次都组装并广播完整 AppState（含全部对话列表）很浪费。
 * request() 把窗口内的多次请求合成一次尾部广播；now() 立即广播并取消排队，
 * 因为排队的那次内容已经被这次覆盖。
 */
export class StateThrottle {
  private timer: Timer | null = null;
  private readonly intervalMs: number;
  private readonly setTimer: (fn: () => void, ms: number) => Timer;
  private readonly clearTimer: (timer: Timer) => void;

  constructor(private readonly send: () => void, options: StateThrottleOptions = {}) {
    this.intervalMs = options.intervalMs ?? 100;
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));
  }

  request(): void {
    if (this.timer) return;
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.send();
    }, this.intervalMs);
  }

  now(): void {
    this.cancel();
    this.send();
  }

  cancel(): void {
    if (!this.timer) return;
    this.clearTimer(this.timer);
    this.timer = null;
  }
}
