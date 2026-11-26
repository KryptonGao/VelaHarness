import { createContext, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { UiAppBlock } from "@vela/shared";

export interface MicroAppTab {
  kind: "micro-app";
  id: string;
  label: string;
  title?: string;
  app: UiAppBlock;
  dock(panel: HTMLDivElement): () => void;
}

export const MicroAppWorkbenchContext = createContext<{
  open(tab: MicroAppTab): void;
  close(id: string): void;
} | null>(null);

export function useMicroAppTabs(activate: (id: string) => void) {
  const [tabs, setTabs] = useState<MicroAppTab[]>([]);
  const close = useCallback((id: string) => {
    setTabs(current => current.some(tab => tab.id === id) ? current.filter(tab => tab.id !== id) : current);
  }, []);
  const actions = useMemo(() => ({ close, open(tab: MicroAppTab) {
    setTabs(current => current.some(item => item.id === tab.id) ? current : [...current, tab]);
    activate(tab.id);
  } }), [activate, close]);
  return { tabs, actions };
}

/** The originating chat still owns the live sandbox and its confirmation UI. */
export function MicroAppPanel({ dock }: Pick<MicroAppTab, "dock">) {
  const panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => dock(panel.current!), [dock]);
  return <div ref={panel} className="iui-workbench-panel" />;
}
