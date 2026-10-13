import { buildTurnOutcome, type ToolTrace, type TurnOutcome } from "@vela/shared";
import type { UiMessage } from "../hooks/useSession";
import { summarizeTurnChanges, type TurnChanges } from "./turn-changes";

export interface AcceptanceRequest {
  /** 本轮最后一条 assistant 消息的 ID。 */
  turnId: string;
  outcome: TurnOutcome;
  tools: ToolTrace[];
  changes: TurnChanges | null;
}

/** 只为结束的回合生成验收；工具分散在多条回复时仍归于同一轮。 */
export function outcomeByFinalMessage(
  messages: UiMessage[],
  streaming: boolean,
  workspaceRoot: string | null,
  changedFilesByTurn?: ReadonlyMap<string, string[]>,
): Map<string, AcceptanceRequest> {
  const requests = new Map<string, AcceptanceRequest>();
  let userText = "";
  let tools: ToolTrace[] = [];
  let lastAssistant: UiMessage | null = null;
  const finish = () => {
    if (lastAssistant) {
      const submission = tools.findLast(tool => tool.name === "submit_outcome" && tool.status === "done" && tool.activity.outcome)?.activity.outcome ?? null;
      const outcome = buildTurnOutcome({ userText, tools, submission, cwd: workspaceRoot ?? "", changedFiles: changedFilesByTurn?.get(lastAssistant.id) });
      const hasFacts = outcome.items.some(item => item.changes.length > 0 || item.evidence.length > 0)
        || outcome.unattributed.files.length > 0 || outcome.unattributed.verifications.length > 0;
      if (submission || hasFacts) {
        const changes = summarizeTurnChanges(tools, workspaceRoot);
        // 现有 review 快照会保留文件的附加字段，用它关联同一文件里的多次编辑。
        if (changes) for (const file of changes.files) {
          const matching = outcome.items.flatMap(item => item.changes).concat(outcome.unattributed.files).find(change => change.path === file.path);
          file.diffToolIds = matching?.diffToolIds.filter(id => tools.some(tool => tool.id === id && Boolean(tool.activity.diff))) ?? [];
        }
        requests.set(lastAssistant.id, { turnId: lastAssistant.id, outcome, tools: [...tools], changes });
      }
    }
    tools = [];
    lastAssistant = null;
  };
  for (const message of messages) {
    if (message.role === "user") { finish(); userText = message.text; }
    else { lastAssistant = message; tools.push(...message.tools); }
  }
  if (!streaming) finish();
  return requests;
}

/** 入口卡与赛马比较共用：只有没有待确认且证据通过的需求计入通过。 */
export function acceptanceCounts(outcome: TurnOutcome): { passed: number; pending: number } {
  const passed = outcome.items.filter(item => item.status === "done" && !item.toConfirm.length && item.evidence.length > 0 && item.evidence.every(evidence => evidence.result === "passed" && !evidence.stale)).length;
  const pending = outcome.items.reduce((sum, item) => sum + item.toConfirm.length, 0);
  return { passed, pending };
}
