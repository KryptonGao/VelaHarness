import type { AgentInfo, ToolTrace } from "@vela/shared";
import { localizeError, tr } from "../locale";
import { AgentModelTag } from "./AgentPanel";
import { Markdown } from "./Markdown";
import { thinkingLabel } from "./ModelControls";
import { ScrollFade } from "./ScrollFade";

/** Roster metadata can fill gaps, but only this call owns its prompt, result and error. */
export function AgentCallDetails({ tool, agent }: { tool: ToolTrace; agent: AgentInfo | null }) {
  const { activity } = tool;
  const effort = activity.thinkingLevel ?? agent?.effectiveThinkingLevel ?? agent?.thinkingLevel;
  const showResult = tool.name === "followup_task";
  const failed = tool.status === "error";
  const missing = tr("未记录", "Not recorded");
  return (
    <ScrollFade className="agent-summary-scroll" contentClassName="process-thinking-text agent-call-details" ariaLabel={tr("工具调用", "Tool call")}>
      <div className="agent-call-meta">
        <AgentModelTag model={activity.model ?? agent?.model} />
        <span>{tr("推理强度", "Reasoning effort")} <strong>{effort ? thinkingLabel(effort) : missing}</strong></span>
      </div>
      <dl className="agent-call-fields">
        {!showResult && <>
          <dt>{tr("提示词", "Prompt")}</dt>
          <dd className="agent-call-prompt">{activity.agentPrompt || missing}</dd>
        </>}
        {(showResult || failed) && <>
          <dt>{failed ? tr("错误", "Error") : tr("返回结果", "Result")}</dt>
          <dd className={failed ? "agent-call-error" : undefined}>
            {failed ? localizeError(activity.body || tr("执行失败", "Execution failed"))
              : activity.body ? <Markdown text={activity.body} />
              : tool.status === "running" ? tr("正在等待工具返回结果…", "Waiting for the tool result…") : tr("暂无结果", "No result")}
          </dd>
        </>}
      </dl>
    </ScrollFade>
  );
}
