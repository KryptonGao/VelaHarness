import { useContext, useMemo, useState } from "react";
import type { PreferencesApi } from "../hooks/usePreferences";
import type { ProjectApi } from "../hooks/useProject";
import { useModels } from "../hooks/useModels";
import { useSession } from "../hooks/useSession";
import { tr } from "../locale";
import { indexAgentHistory, mergeAgentRoster } from "../agent-roster";
import { AgentDirectory } from "./AgentDirectory";
import { AgentPane } from "./AgentPane";
import { AgentWorkspaceProvider } from "./AgentPanel";
import { PlanDocumentPane, PlanDocumentProvider } from "./PlanPanel";
import { RecipeActionsContext } from "./recipe-actions-context";
import { RaceActionsContext } from "./race-actions-context";
import { SessionChatView } from "./SessionChatView";
import { Icon } from "./icons";

/** 每个标签拥有独立会话与输入状态；隐藏标签时保持挂载以继续接收消息。 */
export function WorkbenchChatView({ conversationId, visible, preferences, project, onRenameConversation, onNewTab, onShowDiff, onOpenWebLink }: {
  conversationId: string;
  visible: boolean;
  preferences: PreferencesApi;
  project: ProjectApi;
  onRenameConversation: (id: string) => void;
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
  const [agentView, setAgentView] = useState<{ agentId?: string } | null>(null);
  const agents = useMemo(() => mergeAgentRoster(session.agents, indexAgentHistory(session.agentHistory)), [session.agents, session.agentHistory]);
  const activeAgent = agentView?.agentId ? agents.find(agent => agent.id === agentView.agentId) : undefined;
  const openDirectory = () => setAgentView({});
  const openAgent = (agentId: string) => setAgentView({ agentId });
  const scopedProject = useMemo(() => ({ ...project,
    approval: project.approval?.conversationId && project.approval.conversationId !== conversationId ? null : project.approval,
  }), [project, conversationId]);

  return <RecipeActionsContext.Provider value={scopedRecipeActions}>
    <RaceActionsContext.Provider value={null}>
      <AgentWorkspaceProvider agents={agents} activeAgentId={activeAgent?.id ?? null}
        openAgent={openAgent} closeAgent={openDirectory}>
        <PlanDocumentProvider plans={session.state?.session.planRevisions ?? []} draft={session.planDraft}
          activePlanId={planId} selectedRevisionId={planId} openPlan={setPlanId} closePlan={closePlan} selectRevision={setPlanId}>
          <div className="panel-chat-container">
            <div className="panel-chat-conversation" hidden={Boolean(planId || agentView)}>
              <SessionChatView embedded visible={visible && !planId && !agentView} onOpenAgentDirectory={openDirectory}
                messageStore={session.messageStore} state={session.state} sendError={session.sendError}
                platform={window.vela?.platform ?? "darwin"} project={scopedProject}
                rightCollapsed onToggleRight={() => {}}
                onRenameConversation={onRenameConversation}
                toolDisplay={preferences.toolDisplay} toolFold={preferences.toolFold} runView={preferences.runView}
                toolProcessDetails={preferences.toolProcessDetails}
                summaryEnabled={preferences.thinkingSummary} summaryStyle={preferences.thinkingSummaryStyle}
                summaryModel={preferences.thinkingSummaryModel} locale={preferences.locale}
                recommendedActionsEnabled={preferences.recommendedActions} predictionEnabled={preferences.inputPrediction} predictionModel={preferences.inputPredictionModel}
                hiddenModels={preferences.hiddenModels}
                models={models} onSend={session.send} onRemoveInstruction={session.removeInstruction} onPromoteInstruction={session.promoteInstruction}
                onEdit={session.edit} onAbort={session.abort} onMode={session.setMode}
                question={session.question} getQuestion={session.getQuestion}
                onReplyQuestion={(id, answer) => session.replyQuestion(id, answer)}
                onBranch={index => { void session.branch(index); }}
                showNewTab={false} onNewTab={onNewTab} onOpenChanges={() => onShowDiff()} onOpenWebLink={onOpenWebLink}
                planDraft={session.planDraft} backgroundShells={session.backgroundShells} onOpenPlan={setPlanId}
              />
            </div>
            {planId ? <>
              <div className="panel-chat-plan-toolbar">
                <button type="button" className="view-icon-btn" onClick={closePlan}
                  aria-label={tr("返回聊天", "Back to chat")} title={tr("返回聊天", "Back to chat")}><Icon name="arrow-left" size={16} /></button>
                <span>{tr("计划", "Plan")}</span>
              </div>
              <PlanDocumentPane busy={session.state?.session.status !== "ready"}
                execution={session.state?.session.executionPlan ?? null} visible
                onRevise={() => { void session.setMode("plan"); closePlan(); }}
                onExecutePlan={strategy => { void session.executePlan(strategy); closePlan(); }} />
            </> : activeAgent ? <AgentPane key={activeAgent.id} agent={activeAgent} agents={agents} messageStore={session.messageStore} conversationId={conversationId}
              visible={visible} toolDisplay={preferences.toolDisplay} toolFold={preferences.toolFold} ensureMessages={session.ensureAgentMessages}
              onBackToDirectory={openDirectory} onSwitch={openAgent} onControl={session.controlAgent} onSend={session.sendAgentMessage} /> : agentView ? <>
              <div className="panel-chat-plan-toolbar">
                <button type="button" className="view-icon-btn" onClick={() => setAgentView(null)}
                  aria-label={tr("返回聊天", "Back to chat")} title={tr("返回聊天", "Back to chat")}><Icon name="arrow-left" size={16} /></button>
              </div>
              <AgentDirectory agents={agents} onSelect={openAgent} />
            </> : null}
          </div>
        </PlanDocumentProvider>
      </AgentWorkspaceProvider>
    </RaceActionsContext.Provider>
  </RecipeActionsContext.Provider>;
}
