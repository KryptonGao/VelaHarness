import type { UsageLimits } from "@vela/shared";
import { useCallback, useEffect, useRef, useState } from "react";

/** 只有 ChatGPT 登录的 GPT（Codex）有订阅额度可读。 */
export const usageLimitProvider = "openai-codex";

/** 后台自动刷新的间隔；打开弹窗和一轮对话结束时另外刷新。 */
const refreshIntervalMs = 5 * 60_000;
/** 读取失败后的重试间隔。 */
const retryIntervalMs = 45_000;
/** 两次请求之间的最短间隔，避免对话结束、打开弹窗连续触发。 */
const minGapMs = 20_000;

/**
 * 读取 GPT 订阅额度。当前模型不是 GPT 或没有登录时返回 null，界面据此隐藏圆环；
 * 网络等临时失败保留上一次的数值，并稍后重试，圆环不会因为一次失败消失。
 */
export function useUsageLimits(provider: string | null): { limits: UsageLimits | null; refresh: () => void } {
  const [limits, setLimits] = useState<UsageLimits | null>(null);
  const lastFetchRef = useRef(0);
  const retryRef = useRef<number | null>(null);
  const active = provider === usageLimitProvider;

  const refresh = useCallback(() => {
    const api = window.vela;
    if (!api?.getUsageLimits || !active) return;
    const now = Date.now();
    if (now - lastFetchRef.current < minGapMs) return;
    lastFetchRef.current = now;
    if (retryRef.current !== null) window.clearTimeout(retryRef.current);
    retryRef.current = null;
    void api.getUsageLimits(usageLimitProvider).then(
      (next) => setLimits(next && next.windows.length > 0 ? next : null),
      () => {
        retryRef.current = window.setTimeout(() => {
          retryRef.current = null;
          lastFetchRef.current = 0;
          refresh();
        }, retryIntervalMs);
      },
    );
  }, [active]);

  useEffect(() => {
    if (!active) {
      setLimits(null);
      return;
    }
    lastFetchRef.current = 0;
    refresh();
    const timer = window.setInterval(refresh, refreshIntervalMs);
    return () => {
      window.clearInterval(timer);
      if (retryRef.current !== null) window.clearTimeout(retryRef.current);
      retryRef.current = null;
    };
  }, [active, refresh]);

  return { limits: active ? limits : null, refresh };
}
