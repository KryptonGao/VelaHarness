import { useCallback, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { uiStorage } from "../ui-storage";
import { createLogger } from "../logger";
import { isConversationDetail, type ConversationDetail } from "../components/conversation-detail";
import { emptyPlanDocumentState, type PlanDocumentState } from "../plan-draft";

const log = createLogger("workbench");
export const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const nullableString = (v: unknown) => v === null || typeof v === "string";
const stringIds = (v: unknown): v is string[] => Array.isArray(v) && v.every(id => typeof id === "string") && new Set(v).size === v.length;
function descriptors(v: unknown, valid: (tab: Record<string, unknown>) => boolean) {
  return Array.isArray(v) && v.every(tab => isRecord(tab) && valid(tab)) && stringIds(v.map(tab => tab.id));
}

/** A fixed storage key (workspace paths can exceed the IPC key limit). Switch by lookup, never
 * by copying the outgoing scope into the incoming one. Only committed changes write to disk. */
export function useWorkbenchEntry<T>(key: string, scope: string, fallback: T, accept: (v: unknown) => v is T, enabled = true) {
  const [entries, setEntries] = useState<Record<string, T>>(() => {
    try {
      const data: unknown = enabled && JSON.parse(uiStorage.getItem(key) ?? "null");
      if (isRecord(data)) return Object.fromEntries(Object.entries(data).filter((pair): pair is [string, T] => accept(pair[1])));
    } catch { /* Missing or invalid storage uses the normal first-open layout. */ }
    return {};
  });
  const lastSaved = useRef(entries);
  useLayoutEffect(() => {
    if (!enabled || lastSaved.current === entries) return;
    const save = () => {
      if (lastSaved.current === entries) return;
      try { uiStorage.setItem(key, JSON.stringify(entries)); lastSaved.current = entries; }
      catch (error) { log.error("could not save workbench state", error); }
    };
    // Divider drag sends a layout for every pointer move; write the final position, not each frame.
    if (!document.documentElement.dataset.paneResizing) { save(); return; }
    const events = ["pointerup", "pointercancel", "blur", "pagehide"] as const;
    for (const event of events) window.addEventListener(event, save);
    return () => { for (const event of events) window.removeEventListener(event, save); };
  }, [entries, key, enabled]);
  const set = useCallback((update: SetStateAction<T>) => setEntries(all => {
    const prev = Object.hasOwn(all, scope) ? all[scope] : fallback;
    const next = typeof update === "function" ? (update as (v: T) => T)(prev) : update;
    return next === prev ? all : { ...all, [scope]: next };
  }), [scope, fallback]);
  return [Object.hasOwn(entries, scope) ? entries[scope] : fallback, set] as const;
}

/** Bind a field to its scope, including callbacks that complete after a workspace switch. */
export function useWorkbenchField<T extends object, K extends keyof T>(set: Dispatch<SetStateAction<T>>, key: K) {
  return useCallback((update: SetStateAction<T[K]>) => set(prev => {
    const next = typeof update === "function" ? (update as (v: T[K]) => T[K])(prev[key]) : update;
    return next === prev[key] ? prev : { ...prev, [key]: next };
  }), [set, key]);
}

interface WorkspaceTabs {
  starts: { id: string }[]; chats: { id: string; conversationId: string }[]; sideChat: string | null;
  files: boolean; background: boolean; race: boolean; changes: boolean;
}
export const emptyWorkspaceTabs: WorkspaceTabs = { starts: [], chats: [], sideChat: null, files: false, background: false, race: false, changes: false };
export const isWorkspaceTabs = (v: unknown): v is WorkspaceTabs => isRecord(v) && descriptors(v.starts, () => true)
  && descriptors(v.chats, t => typeof t.conversationId === "string") && nullableString(v.sideChat)
  && [v.files, v.background, v.race, v.changes].every(flag => typeof flag === "boolean");
interface ConversationTabs { details: { id: string; view: ConversationDetail }[]; agents: string[]; directory: boolean; plan: PlanDocumentState }
export const emptyConversationTabs: ConversationTabs = { details: [], agents: [], directory: false, plan: emptyPlanDocumentState };
export const isConversationTabs = (v: unknown): v is ConversationTabs => isRecord(v)
  && descriptors(v.details, t => typeof t.view === "string" && isConversationDetail(t.view)) && stringIds(v.agents) && typeof v.directory === "boolean"
  && isRecord(v.plan) && nullableString(v.plan.activePlanId) && nullableString(v.plan.selectedRevisionId);

export type WorkbenchView = "split" | "panel" | "chat";
interface Presentation { view: WorkbenchView | null; collapsed: boolean; active: string | null; order: string[] }
export const emptyPresentation: Presentation = { view: null, collapsed: false, active: null, order: [] };
export const isPresentation = (v: unknown): v is Presentation => isRecord(v) && (v.view === null || v.view === "split" || v.view === "panel" || v.view === "chat")
  && typeof v.collapsed === "boolean" && nullableString(v.active) && stringIds(v.order);
