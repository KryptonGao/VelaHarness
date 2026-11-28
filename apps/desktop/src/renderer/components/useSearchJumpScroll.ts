import { useEffect, type RefObject } from "react";
import type { UiMessage } from "../hooks/useSession";
import { fadeSearchHighlight, highlightMatches } from "./search-highlight";
import { findJumpMessage, searchJumpLifetimeMs, searchJumpStore, useSearchJump } from "./search-jump";

/** The highlight stays this long after the jump, then fades out of the chat. */
const highlightMs = 6000;

interface Options {
  /** This view shows `conversationId` and may scroll. */
  enabled: boolean;
  conversationId: string | null;
  messages: readonly UiMessage[];
  /** Turn that contains a message, as it is rendered. */
  turnIdOf: (messageId: string) => string | null;
  scrollerRef: RefObject<HTMLElement | null>;
  surfaceRef: RefObject<HTMLElement | null>;
  /** Stop following the end of the chat, so the jump is not undone by new content. */
  release: () => void;
}

/**
 * Scroll the open chat to the message a search hit pointed at, then highlight the matched text.
 * Waits for the chat's messages to load and for the turn to render, and gives up after a few seconds.
 */
export function useSearchJumpScroll({ enabled, conversationId, messages, turnIdOf, scrollerRef, surfaceRef, release }: Options): void {
  const jump = useSearchJump();
  useEffect(() => {
    if (!jump || !enabled || jump.conversationId !== conversationId) return;
    const age = Date.now() - jump.requestedAt;
    if (age >= searchJumpLifetimeMs) { searchJumpStore.clear(jump.nonce); return; }
    const expire = window.setTimeout(() => searchJumpStore.clear(jump.nonce), searchJumpLifetimeMs - age);
    const messageId = findJumpMessage(messages, jump);
    const turnId = messageId ? turnIdOf(messageId) : null;
    let frame = 0;
    let tries = 0;
    const attempt = () => {
      const scroller = scrollerRef.current;
      const turn = turnId ? Array.from(surfaceRef.current?.children ?? []).find(
        (element): element is HTMLElement => element instanceof HTMLElement && element.dataset.turnId === turnId,
      ) : undefined;
      if (!scroller || !turn) {
        // The turn may not be rendered yet.
        if (++tries < 90) frame = requestAnimationFrame(attempt);
        return;
      }
      release();
      const inset = parseFloat(getComputedStyle(scroller).paddingTop) || 0;
      const viewTop = () => scroller.getBoundingClientRect().top;
      const toTurn = () => { scroller.scrollTop = Math.max(0, scroller.scrollTop + turn.getBoundingClientRect().top - viewTop() - inset); };
      // Turns off screen are laid out lazily, so place the turn first, then the text inside it.
      const toText = () => {
        const rect = highlightMatches(turn, jump.keywords)?.getBoundingClientRect();
        if (rect && rect.height > 0) scroller.scrollTop = Math.max(0, scroller.scrollTop + rect.top - viewTop() - scroller.clientHeight / 3);
        else toTurn();
      };
      toTurn();
      frame = requestAnimationFrame(() => {
        toText();
        // Laying out the turn can move things once more.
        frame = requestAnimationFrame(() => {
          toText();
          fadeSearchHighlight(highlightMs);
          searchJumpStore.clear(jump.nonce);
        });
      });
    };
    if (turnId) frame = requestAnimationFrame(attempt);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(expire);
    };
  }, [jump, enabled, conversationId, messages, turnIdOf, scrollerRef, surfaceRef, release]);
}
