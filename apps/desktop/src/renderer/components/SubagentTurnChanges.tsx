import { isAgentBusy, type AgentInfo } from "@vela/shared";
import { useEffect, useMemo } from "react";
import type { UiMessage } from "../hooks/useSession";
import type { MessageStore } from "../hooks/message-store";
import { useMessages } from "../hooks/useMessages";
import { useOwnedAgentMessages } from "../hooks/useSubagentTrace";
import { ChangeSummaryPill } from "./composer/ChangeSummaryPill";
import { createLiveChangesSelector, isCompletedFileEdit, type TurnReviewRequest } from "./turn-changes";

/** The pill follows the current turn. An open review follows its original tool call,
 * even when the source tab is hidden or the agent starts another turn. */
export function SubagentTurnChanges({ agent, conversationId, workspaceRoot, messageStore, providedMessages, toolId, onOpen, onRefresh }: {
  agent: AgentInfo; conversationId: string | null; workspaceRoot: string | null;
  messageStore?: MessageStore; providedMessages?: UiMessage[]; toolId?: string;
  onOpen?: (review: TurnReviewRequest) => void;
  onRefresh?: (liveId: string, review: TurnReviewRequest) => void;
}) {
  const liveMessages = useMessages(messageStore, conversationId, agent.id);
  const { messages, loading } = useOwnedAgentMessages(conversationId, agent, messageStore ? liveMessages : providedMessages ?? liveMessages);
  const selectChanges = useMemo(createLiveChangesSelector, []);
  const review = useMemo((): TurnReviewRequest | null => {
    if (loading) return null;
    const anchor = toolId ? messages.findIndex(m => m.tools.some(t => t.id === toolId)) : messages.length - 1;
    if (anchor < 0) return null;
    let start = anchor, end = anchor + 1;
    while (start >= 0 && messages[start]!.role !== "user") start--;
    while (end < messages.length && messages[end]!.role !== "user") end++;
    const turn = messages.slice(start + 1, end);
    const changes = selectChanges(turn, workspaceRoot);
    if (!changes) return null;
    const id = toolId ?? turn.flatMap(m => m.tools).find(t => isCompletedFileEdit(t) && t.activity?.path)?.id;
    if (!id) return null;
    return { turnId: JSON.stringify([conversationId, agent.id, id]), changes,
      live: end === messages.length && isAgentBusy(agent.status), subagent: { agentId: agent.id, toolId: id } };
  }, [messages, loading, conversationId, agent.id, agent.status, toolId, workspaceRoot, selectChanges]);
  const changes = review?.changes, live = review?.live, turnId = review?.turnId;
  // Text deltas can rebuild the message array without changing any saved edits.
  useEffect(() => {
    if (toolId && turnId && changes && onRefresh) onRefresh(turnId, { turnId, changes, live, subagent: { agentId: agent.id, toolId } });
  }, [toolId, turnId, changes, live, onRefresh, agent.id]);
  return review?.live && onOpen ? <ChangeSummaryPill changes={review.changes} onReview={() => onOpen(review)} /> : null;
}
