import { useEffect, useState } from "react";
import type { RacesState } from "@vela/shared";

const empty: RacesState = { races: [], error: null };

/** 赛马记录的唯一权威在主进程；这里只订阅变化并刷新。 */
export function useRaces(enabled: boolean): RacesState {
  const [state, setState] = useState<RacesState>(empty);
  const api = enabled && typeof window !== "undefined" ? window.vela?.races : undefined;
  useEffect(() => {
    if (!api) {
      setState(empty);
      return;
    }
    let active = true;
    const reload = async () => {
      try {
        const next = await api.list();
        if (active) setState(next);
      } catch (error) {
        if (active) setState(current => ({ ...current, error: error instanceof Error ? error.message : String(error) }));
      }
    };
    const unsubscribe = api.subscribe(reload);
    void reload();
    return () => {
      active = false;
      unsubscribe();
    };
  }, [api]);
  return api ? state : empty;
}
