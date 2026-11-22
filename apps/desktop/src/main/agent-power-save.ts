import type { AgentRuntime } from "@vela/agent";
import { createLogger } from "@vela/shared";
import type { BackgroundShellManager } from "@vela/workspace";
import type { PowerSaveBlocker } from "electron";

const log = createLogger("agent-power-save");

interface ConversationWork {
  rootRunning: boolean;
  childRunning: boolean;
  shellRunning: boolean;
  questionId?: string;
  otherTools: Set<string>;
}

function needsPower(work: ConversationWork): boolean {
  if (work.childRunning || work.shellRunning) return true;
  // A question can wait indefinitely. Another tool in the same batch can still be running.
  return work.rootRunning && (!work.questionId || work.otherTools.size > 0);
}

/** Attach at runtime creation, before the desktop accepts prompts or starts scheduled work. */
export function preventAgentIdleSleep(
  runtime: Pick<AgentRuntime, "subscribe" | "subscribeQuestions" | "getConversationInfo">,
  shells: Pick<BackgroundShellManager, "subscribeChanges" | "list">,
  blocker: Pick<PowerSaveBlocker, "start" | "stop">,
): () => void {
  const conversations = new Map<string, ConversationWork>();
  let blockerId: number | null = null;

  function setBlocked(active: boolean): void {
    try {
      if (active && blockerId === null) blockerId = blocker.start("prevent-app-suspension");
      else if (!active && blockerId !== null) {
        blocker.stop(blockerId);
        blockerId = null;
      }
    } catch (error) {
      log.warn("Could not update the system idle sleep blocker", error);
    }
  }

  function update(id: string, change: (work: ConversationWork) => void): void {
    const work = conversations.get(id) ?? { rootRunning: false, childRunning: false, shellRunning: false, otherTools: new Set<string>() };
    change(work);
    if (work.rootRunning || work.childRunning || work.shellRunning) conversations.set(id, work);
    else conversations.delete(id);
    setBlocked([...conversations.values()].some(needsPower));
  }

  const offRuntime = runtime.subscribe(event => {
    if (event.type !== "status" && event.type !== "agents" && event.type !== "prompt_idle"
      && event.type !== "tool_start" && event.type !== "tool_end") return;
    update(event.conversationId, work => {
      work.rootRunning = runtime.getConversationInfo(event.conversationId)?.status === "streaming";
      if (event.type === "agents") work.childRunning = event.agents.some(agent => agent.kind !== "root" && agent.status === "running");
      if (!work.rootRunning) {
        work.otherTools.clear();
        delete work.questionId;
      } else if (event.type === "tool_start" && event.toolName !== "ask_user_question" && !event.activity.streaming) {
        work.otherTools.add(event.toolCallId);
      } else if (event.type === "tool_end") {
        work.otherTools.delete(event.toolCallId);
      }
    });
  });
  const offQuestions = runtime.subscribeQuestions(event => {
    if (event.type === "request") {
      update(event.request.conversationId, work => { work.questionId = event.request.id; });
    } else {
      for (const [id, work] of conversations) {
        if (work.questionId === event.id) {
          update(id, state => { delete state.questionId; });
          break;
        }
      }
    }
  });
  // The shell manager also reports exits after the owning conversation is removed.
  const offShells = shells.subscribeChanges(id => update(id, work => {
    work.shellRunning = shells.list(id).some(shell => shell.status === "running");
  }));

  return () => {
    offRuntime();
    offQuestions();
    offShells();
    setBlocked(false);
    conversations.clear();
  };
}
