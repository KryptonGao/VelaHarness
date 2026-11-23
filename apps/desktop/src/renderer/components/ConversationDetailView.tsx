import type { AppState, ProviderSummary } from "@vela/shared";
import type { ConversationDetail } from "./conversation-detail";
import { ContextTab } from "./ContextTab";
import { TaskBudgetTab } from "./TaskBudgetTab";
import { TraceView } from "./trace/TraceView";
import { UsageView } from "./usage/UsageView";

export function ConversationDetailView({ view, state, providers, pendingInteraction, onConversation, onAbort }: {
  view: ConversationDetail;
  state: AppState | null;
  providers: ProviderSummary[];
  pendingInteraction: boolean;
  onConversation(): void;
  onAbort(): Promise<void>;
}) {
  const conversationId = state?.activeConversationId ?? null;
  switch (view) {
    case "trace": return <TraceView state={state} pendingInteraction={pendingInteraction} onConversation={onConversation} onAbort={onAbort} />;
    case "usage": return <UsageView conversationId={conversationId} providers={providers} />;
    case "context": return <ContextTab conversationId={conversationId} context={state?.context} />;
    case "budget": return <TaskBudgetTab conversationId={conversationId} budget={state?.session.taskBudget} />;
  }
}
