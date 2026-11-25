import { useEffect, useMemo, useState } from "react";
import type { AgentInfo, TranscriptMessage } from "@vela/shared";
import type { TraceState } from "../components/trace/trace-model";
import { isTraceChild, ownedTraceMessages, projectSubagentTrace } from "../components/trace/subagent-trace";
import { messageScope, type MessageStore } from "./message-store";
import { useMessages } from "./useMessages";

interface History { scope: string; messages: TranscriptMessage[]; error: string | null }
const none: TranscriptMessage[] = [];

/** mainTrace must be the scope-guarded result of useTrace(conversationId).
 * Only its separately recorded agentRequests cross into the child projection. */
export function useSubagentTrace({ conversationId, agent, mainTrace, messageStore }: {
  conversationId: string | null; agent: AgentInfo | null; mainTrace: TraceState; messageStore?: MessageStore;
}) {
  const agentId = isTraceChild(conversationId, agent) ? agent.id : null;
  const scope = agentId && conversationId ? messageScope(conversationId, agentId) : null;
  const stream = useMessages(messageStore, agentId ? conversationId : null, agentId ?? undefined);
  const [history, setHistory] = useState<History | null>(null);
  const busy = agent?.status === "running" || agent?.status === "paused";
  useEffect(() => {
    if (!scope || !agentId || !conversationId) { setHistory(null); return; }
    let active = true;
    const api = window.vela;
    if (!api?.getAgentMessages) { setHistory({ scope, messages: none, error: null }); return; }
    void api.getAgentMessages(conversationId, agentId, "owned").then(messages => {
      if (active) setHistory({ scope, messages, error: null });
    }).catch(e => {
      if (active) setHistory(old => ({ scope, messages: old?.scope === scope ? old.messages : none, error: String(e) }));
    });
    return () => { active = false; };
  }, [scope, conversationId, agentId, busy, mainTrace.resetVersion]);
  const current = history?.scope === scope ? history : null;
  const loading = scope !== null && current === null;
  const saved = current?.messages ?? none;
  const messages = useMemo(() => ownedTraceMessages(saved, stream), [saved, stream]);
  const projection = useMemo(() => projectSubagentTrace(conversationId, agent, messages, mainTrace.agentRequests, !loading),
    [conversationId, agent, messages, mainTrace.agentRequests, loading]);
  return { ...projection, loading, error: current?.error ?? null };
}
