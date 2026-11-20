import { createContext } from "react";

/** Scoped to conversation content. Returning false preserves native link handling. */
export const ConversationLinkContext = createContext<((url: string) => boolean) | null>(null);

/** Explicit panel actions, independent of the preference for ordinary conversation links. */
export const BrowserPanelLinkContext = createContext<((url: string) => void) | null>(null);
