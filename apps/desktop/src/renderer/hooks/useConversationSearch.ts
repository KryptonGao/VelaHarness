import {
  parseSearchQuery,
  type ConversationSearchEvent,
  type ConversationSearchHit,
  type ConversationSearchIndexStatus,
} from "@vela/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { scopeFilters, type SearchScope } from "../components/conversation-search";

/** Wait this long after a keystroke before searching, so typing does not start a search per letter. */
const typingDelayMs = 80;

export interface ConversationSearchResults {
  hits: ConversationSearchHit[];
  /** The search is still producing results. */
  searching: boolean;
  /** Older matches exist beyond the ones shown. */
  hasMore: boolean;
  /** The index is still being built, so results may be missing. */
  indexing: boolean;
  failed: boolean;
  loadMore: () => void;
}

interface Run {
  id: string;
  /** Add to the hits shown instead of replacing them. */
  append: boolean;
  /** The first batch of a replacing run has arrived and taken the place of the previous hits. */
  replaced: boolean;
}

/**
 * Message search for the search dialog. Hits are shown as each batch arrives from the main
 * process; the previous hits stay until the new search has something to show in their place.
 */
export function useConversationSearch(query: string, scope: SearchScope): ConversationSearchResults {
  const [hits, setHits] = useState<ConversationSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [next, setNext] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [index, setIndex] = useState<ConversationSearchIndexStatus>({ indexing: false, indexed: 0, total: 0 });
  const run = useRef<Run | null>(null);
  const latest = useRef({ query, scope });
  latest.current = { query, scope };
  /** The index is catching up with new or changed chats. */
  const indexing = useRef(false);
  /** The hits shown were read while the index was catching up, so they may be incomplete. */
  const partial = useRef(false);

  const start = useCallback((append: boolean, after?: number) => {
    const api = window.vela?.conversationSearch;
    if (!api) return;
    const previous = run.current;
    if (previous) void api.cancel(previous.id).catch(() => undefined);
    const id = crypto.randomUUID();
    run.current = { id, append, replaced: append };
    partial.current = indexing.current;
    setSearching(true);
    setFailed(false);
    const { query: text, scope: current } = latest.current;
    api.start(id, { query: text, filters: scopeFilters(current), ...(after !== undefined ? { after } : {}) }).catch(() => {
      if (run.current?.id !== id) return;
      run.current = null;
      setSearching(false);
      setFailed(true);
    });
  }, []);

  useEffect(() => {
    const api = window.vela?.conversationSearch;
    if (!api) return;
    const update = (status: ConversationSearchIndexStatus) => {
      const was = indexing.current;
      indexing.current = status.indexing;
      setIndex(status);
      if (status.indexing) partial.current = true;
      // Searching an index that was still being filled leaves results out; look again once it has caught up.
      else if (was && partial.current && parseSearchQuery(latest.current.query).length) start(false);
    };
    const apply = (event: ConversationSearchEvent) => {
      if (event.type === "index") {
        update(event);
        return;
      }
      const current = run.current;
      if (!current || current.id !== event.requestId) return;
      if (event.type === "hits") {
        const replace = !current.replaced;
        current.replaced = true;
        setHits(existing => replace ? event.hits : [...existing, ...event.hits]);
      } else if (event.type === "done") {
        if (!current.replaced) setHits([]);
        run.current = null;
        setNext(event.next);
        setSearching(false);
      } else {
        run.current = null;
        setSearching(false);
        setFailed(true);
      }
    };
    const unsubscribe = api.subscribe(apply);
    // Refreshes the chat list the index follows and starts catching up on anything new.
    void api.sync().then(update, () => undefined);
    return () => {
      unsubscribe();
      const current = run.current;
      run.current = null;
      if (current) void api.cancel(current.id).catch(() => undefined);
    };
  }, [start]);

  useEffect(() => {
    const api = window.vela?.conversationSearch;
    if (!api) return;
    if (!parseSearchQuery(query).length) {
      const current = run.current;
      run.current = null;
      if (current) void api.cancel(current.id).catch(() => undefined);
      setHits([]);
      setNext(null);
      setSearching(false);
      setFailed(false);
      return;
    }
    const timer = window.setTimeout(() => start(false), typingDelayMs);
    return () => window.clearTimeout(timer);
  }, [query, scope, start]);

  const loadMore = useCallback(() => {
    if (next !== null) start(true, next);
  }, [next, start]);

  return { hits, searching, hasMore: next !== null && !searching, indexing: index.indexing, failed, loadMore };
}
