import { createContext, useContext, useEffect, useState } from "react";
import type { ThinkingActivity } from "../components/thinking-activity";
import { defaultThinkingActivityDelayMs } from "../thinking-activity-delay";

/** Zero disables the delay, not the live activity headline. */
export const ThinkingActivityDelayContext = createContext(defaultThinkingActivityDelayMs);

/** Keep the thought headline for quick calls; streaming updates must not restart the delay. */
export function useDelayedThinkingActivity(activity: ThinkingActivity | null): ThinkingActivity | null {
  const delayMs = useContext(ThinkingActivityDelayContext);
  const id = activity?.tool.id ?? null;
  const [visible, setVisible] = useState<{ id: string; delayMs: number } | null>(null);

  useEffect(() => {
    setVisible(null);
    if (id === null || delayMs === 0) return;
    const timer = window.setTimeout(() => setVisible({ id, delayMs }), delayMs);
    return () => window.clearTimeout(timer);
  }, [id, delayMs]);

  // Never retain a completed call or show stale activity after the setting changes.
  return delayMs === 0 || (id !== null && visible?.id === id && visible.delayMs === delayMs) ? activity : null;
}
