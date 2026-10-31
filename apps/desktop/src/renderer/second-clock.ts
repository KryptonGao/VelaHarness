type Timer = ReturnType<typeof setInterval>;

export interface SecondClockOptions {
  periodMs?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => Timer;
  clearTimer?: (timer: Timer) => void;
}

export type ClockListener = (now: number) => void;

/**
 * 所有“每秒刷新一次用时”的组件共用一个定时器：有订阅者才起，最后一个退订就停。
 * 同一个 tick 里依次回调各订阅者，React 会把这些 setState 合成一次渲染。
 */
export function createSecondClock(options: SecondClockOptions = {}) {
  const periodMs = options.periodMs ?? 1000;
  const now = options.now ?? Date.now;
  const setTimer = options.setTimer ?? ((fn, ms) => setInterval(fn, ms));
  const clearTimer = options.clearTimer ?? ((timer) => clearInterval(timer));
  const listeners = new Set<ClockListener>();
  let timer: Timer | null = null;

  function subscribe(listener: ClockListener): () => void {
    listeners.add(listener);
    if (!timer) {
      timer = setTimer(() => {
        const value = now();
        for (const item of [...listeners]) item(value);
      }, periodMs);
    }
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0 && timer) {
        clearTimer(timer);
        timer = null;
      }
    };
  }

  return { subscribe, size: () => listeners.size };
}

export const secondClock = createSecondClock();
