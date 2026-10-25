import { createOrbRotation, drawOrbStyle, orbDwellMs, type OrbActivity, type OrbStyle } from "./jump-orb";

interface Timers {
  set: (callback: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

interface ActivityState {
  style: OrbStyle | undefined;
  timer: unknown;
  listeners: Set<() => void>;
}

/**
 * 行内指示器共用的样式轮换:同一时刻同一种活动的所有指示器显示同一个样式,
 * 有订阅者时按 jump-orb.ts 的规则定时换下一个,没有订阅者时停表。
 */
export function createOrbStyleStore(
  random: () => number = Math.random,
  timers: Timers = { set: (callback, ms) => setTimeout(callback, ms), clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) },
) {
  const rotation = createOrbRotation();
  const states: Record<OrbActivity, ActivityState> = {
    thinking: { style: undefined, timer: undefined, listeners: new Set() },
    command: { style: undefined, timer: undefined, listeners: new Set() },
  };

  const current = (activity: OrbActivity): OrbStyle => {
    const state = states[activity];
    state.style ??= drawOrbStyle(rotation, activity, random);
    return state.style;
  };

  const schedule = (activity: OrbActivity) => {
    const state = states[activity];
    state.timer = timers.set(() => {
      state.style = drawOrbStyle(rotation, activity, random);
      state.listeners.forEach((listener) => listener());
      schedule(activity);
    }, orbDwellMs(current(activity), random));
  };

  return {
    get: current,
    subscribe(activity: OrbActivity, listener: () => void): () => void {
      const state = states[activity];
      state.listeners.add(listener);
      if (state.listeners.size === 1) schedule(activity);
      return () => {
        state.listeners.delete(listener);
        if (state.listeners.size === 0) {
          timers.clear(state.timer);
          state.timer = undefined;
        }
      };
    },
  };
}

export const sharedOrbStyles = createOrbStyleStore();
