import { useEffect, useState } from "react";
import type { ThinkingActivity } from "../components/thinking-activity";

export const THINKING_ACTIVITY_DELAY_MS = 500;

/** Keep the thought headline for quick calls; streaming updates must not restart the delay. */
export function useDelayedThinkingActivity(activity: ThinkingActivity | null): ThinkingActivity | null {
  const id = activity?.tool.id ?? null;
  const [visibleId, setVisibleId] = useState<string | null>(null);

  useEffect(() => {
    setVisibleId(null);
    if (id === null) return;
    const timer = window.setTimeout(() => setVisibleId(id), THINKING_ACTIVITY_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [id]);

  // Never retain a completed call or show the previous call while the next one is pending.
  return id !== null && visibleId === id ? activity : null;
}
