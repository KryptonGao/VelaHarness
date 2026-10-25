import { useContext, useMemo, useState } from "react";
import type { PreferencesApi } from "../hooks/usePreferences";
import type { ProjectApi } from "../hooks/useProject";
import { useModels } from "../hooks/useModels";
import { useSession } from "../hooks/useSession";
import { tr } from "../locale";
import { AgentWorkspaceProvider } from "./AgentPanel";
import { ArrowLeftIcon } from "./icons";
import { PlanDocumentPane, PlanDocumentProvider } from "./PlanPanel";
import { RecipeActionsContext } from "./recipe-actions-context";
import { RaceActionsContext } from "./race-actions-context";
import { SessionChatView } from "./SessionChatView";

/** 每个标签拥有独立会话与输入状态；隐藏标签时保持挂载以继续接收消息。 */
export function WorkbenchChatView({ conversationId, preferences, project, onRenameConversation, onOpenConversation, onNewTab, onShowDiff, onOpenWebLink }: {
  conversationId: string;
  preferences: PreferencesApi;
  project: ProjectApi;
  onRenameConversation: (id: string) => void;
  onOpenConversation: (id: string) => void;
  onNewTab: () => void;
  onShowDiff: (path?: string) => void;
  onOpenWebLink: (url: string) => boolean;
}) {
  const session = useSession(undefined, conversationId);
  const models = useModels(session.setAppState, conversationId);
  const recipeActions = useContext(RecipeActionsContext);
  const scopedRecipeActions = useMemo(() => recipeActions ? {
    ...recipeActions, conversationId, useRecipe: undefined,
  } : null, [recipeActions, conversationId]);
  const [planId, setPlanId] = useState<string | null>(null);
  const closePlan = () => setPlanId(null);
  const scopedProject = useMemo(() => ({ ...project,
    approval: project.approval?.conversationId && project.approval.conversationId !== conversationId ? null : project.approval,
  }), [project, conversationId]);

  return <RecipeActionsContext.Provider value={scopedRecipeActions}>
    <RaceActionsContext.Provider value={null}>
      <AgentWorkspaceProvider agents={session.agents} activeAgentId={null}
        openAgent={() => onOpenConversation(conversationId)} closeAgent={() => {}}>
        <PlanDocumentProvider plans={session.state?.session.planRevisions ?? []} draft={session.planDraft}
          activePlanId={planId} selectedRevisionId={planId} openPlan={setPlanId} closePlan={closePlan} selectRevision={setPlanId}>
          <div className="panel-chat-container">
            <div className="panel-chat-conversation" hidden={Boolean(planId)}>
              <SessionChatView embedded
                messageStore={session.messageStore} state={session.state} sendError={session.sendError}
                platform={window.vela?.platform ?? "darwin"} project={scopedProject}
                leftCollapsed={false} onToggleLeft={() => {}} rightCollapsed onToggleRight={() => {}}
                onRenameConversation={onRenameConversation}
                toolDisplay={preferences.toolDisplay} toolFold={preferences.toolFold} runView={preferences.runView}
                toolProcessDetails={preferences.toolProcessDetails}
                summaryEnabled={preferences.thinkingSummary} summaryStyle={preferences.thinkingSummaryStyle}
                summaryModel={preferences.thinkingSummaryModel} locale={preferences.locale}
                recommendedActionsEnabled={preferences.recommendedActions} predictionEnabled={preferences.inputPrediction} predictionModel={preferences.inputPredictionModel}
                hiddenModels={preferences.hiddenModels} sendButtonIcon={preferences.sendButtonIcon}
                models={models} onSend={session.send} onRemoveInstruction={session.removeInstruction}
                onEdit={session.edit} onAbort={session.abort} onMode={session.setMode}
                question={session.question} getQuestion={session.getQuestion}
                onReplyQuestion={(id, answer) => session.replyQuestion(id, answer)}
                onBranch={index => { void session.branch(index); }}
                showNewTab={false} onNewTab={onNewTab} onOpenChanges={() => onShowDiff()} onOpenWebLink={onOpenWebLink}
                planDraft={session.planDraft} onOpenPlan={setPlanId}
              />
            </div>
            {planId ? <>
              <div className="panel-chat-plan-toolbar">
                <button type="button" className="view-icon-btn" onClick={closePlan}
                  aria-label={tr("返回聊天", "Back to chat")} title={tr("返回聊天", "Back to chat")}><ArrowLeftIcon size={15} /></button>
                <span>{tr("计划", "Plan")}</span>
              </div>
              <PlanDocumentPane busy={session.state?.session.status !== "ready"}
                execution={session.state?.session.executionPlan ?? null} visible
                onRevise={() => { void session.setMode("plan"); closePlan(); }}
                onExecutePlan={strategy => { void session.executePlan(strategy); closePlan(); }} />
            </> : null}
          </div>
        </PlanDocumentProvider>
      </AgentWorkspaceProvider>
    </RaceActionsContext.Provider>
  </RecipeActionsContext.Provider>;
}
