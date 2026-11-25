import type { AgentInfo, AppState, ProviderSummary } from "@vela/shared";
import type { MessageStore } from "../hooks/message-store";
import type { ConversationDetail } from "./conversation-detail";
import { ContextTab } from "./ContextTab";
import { TaskBudgetTab } from "./TaskBudgetTab";
import { TraceView } from "./trace/TraceView";
import { UsageView } from "./usage/UsageView";

export function ConversationDetailView({ view, state, agents, messageStore, providers, pendingInteraction, onConversation, onAbort }: {
  view: ConversationDetail;
  state: AppState | null;
  providers: ProviderSummary[];
  agents?: readonly AgentInfo[];
  messageStore?: MessageStore;
  pendingInteraction: boolean;
  onConversation(): void;
  onAbort(): Promise<void>;
}) {
  const conversationId = state?.activeConversationId ?? null;
  switch (view) {
    case "trace": return <TraceView state={state} agents={agents} messageStore={messageStore} pendingInteraction={pendingInteraction} onConversation={onConversation} onAbort={onAbort} />;
    case "usage": return <UsageView conversationId={conversationId} providers={providers} />;
    case "context": return <ContextTab conversationId={conversationId} context={state?.context} />;
    case "budget": return <TaskBudgetTab conversationId={conversationId} budget={state?.session.taskBudget} />;
  }
}
