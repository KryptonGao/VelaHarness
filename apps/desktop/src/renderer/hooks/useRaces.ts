import { useCallback, useEffect, useState } from "react";
import type { RacesState } from "@vela/shared";

const empty: RacesState = { races: [], error: null };

/** 赛马记录的唯一权威在主进程；这里只订阅变化并刷新。 */
export function useRaces() {
  const [state, setState] = useState<RacesState>(empty);
  const api = typeof window === "undefined" ? undefined : window.vela?.races;
  const reload = useCallback(async () => {
    if (!api) return;
    try { setState(await api.list()); }
    catch (error) { setState(current => ({ ...current, error: error instanceof Error ? error.message : String(error) })); }
  }, [api]);
  useEffect(() => {
    if (!api) return;
    void reload();
    return api.subscribe(() => { void reload(); });
  }, [api, reload]);
  return { available: Boolean(api), state, reload };
}
