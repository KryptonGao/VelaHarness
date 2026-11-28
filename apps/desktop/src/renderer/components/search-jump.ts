import { useSyncExternalStore } from "react";

/** Where a search hit lives, so the chat that opens next can scroll to it. */
export interface SearchJump {
  conversationId: string;
  entryId: string;
  /** Set when the hit is a tool call or its output. */
  toolCallId: string | null;
  /** What was searched for, to highlight in the message. */
  keywords: string[];
  nonce: number;
  requestedAt: number;
}

/** A jump that was not applied within this long is dropped, so opening the chat later does not scroll. */
export const searchJumpLifetimeMs = 8000;

let current: SearchJump | null = null;
let counter = 0;
const listeners = new Set<() => void>();

function publish(next: SearchJump | null): void {
  current = next;
  for (const listener of listeners) listener();
}

export const searchJumpStore = {
  request(jump: Omit<SearchJump, "nonce" | "requestedAt">, now = Date.now()): SearchJump {
    const next = { ...jump, nonce: ++counter, requestedAt: now };
    publish(next);
    return next;
  },
  /** Drop the jump, unless a newer one has replaced it. */
  clear(nonce: number): void {
    if (current?.nonce === nonce) publish(null);
  },
  get: (): SearchJump | null => current,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
};

export function useSearchJump(): SearchJump | null {
  return useSyncExternalStore(searchJumpStore.subscribe, searchJumpStore.get);
}

interface Locatable {
  id: string;
  entryId?: string;
  tools: readonly { id: string }[];
}

/** The message a hit belongs to: the one that made the tool call, or the one stored in that session entry. */
export function findJumpMessage(messages: readonly Locatable[], jump: Pick<SearchJump, "entryId" | "toolCallId">): string | null {
  if (jump.toolCallId) {
    const owner = messages.find(message => message.tools.some(tool => tool.id === jump.toolCallId));
    if (owner) return owner.id;
  }
  return messages.find(message => message.entryId === jump.entryId)?.id ?? null;
}

interface Aligned {
  role: string;
  text: string;
  entryId?: string;
}

/**
 * Give messages that were created live in this session the session entry they were saved to.
 * `saved` is the same chat read back from disk. Messages are matched in order by role and text.
 * Returns `messages` itself when nothing changed.
 */
export function alignEntryIds<T extends Aligned>(messages: readonly T[], saved: readonly Aligned[]): readonly T[] {
  const savedText = saved.map(message => message.text.trim());
  let next = 0;
  let changed = false;
  const result = messages.map(message => {
    if (message.entryId) return message;
    const text = message.text.trim();
    // Both lists are in chat order, so a match is never far past the last one.
    const end = Math.min(saved.length, next + alignWindow);
    for (let index = next; index < end; index += 1) {
      const candidate = saved[index]!;
      if (candidate.role !== message.role || savedText[index] !== text || !candidate.entryId) continue;
      next = index + 1;
      changed = true;
      return { ...message, entryId: candidate.entryId };
    }
    return message;
  });
  return changed ? result : messages;
}

const alignWindow = 200;
