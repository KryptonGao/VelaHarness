import type { AgentInfo } from "@vela/shared";
import { useMemo } from "react";
import { groupAgentDirectory } from "../agent-roster";
import { tr, useAppLocale } from "../locale";
import { AgentAvatar } from "./AgentAvatar";
import { agentKindLabel, agentStateText } from "./AgentPanel";
import { sideChatTimeLabel } from "./side-chat-model";
import { Icon } from "./icons";

export function AgentDirectory({ agents, onSelect }: {
  agents: readonly AgentInfo[];
  onSelect: (id: string) => void;
}) {
  const locale = useAppLocale();
  const groups = useMemo(() => groupAgentDirectory(agents), [agents]);
  const now = Date.now();
  const title = tr("子代理目录", "Subagent directory");
  return <section className="agent-directory" aria-label={title}>
    <div className="agent-directory-inner">
      <h2>{title}</h2>
      {(["running", "completed"] as const).map(key => {
        const items = groups[key];
        const label = key === "running" ? tr("运行中", "Running") : tr("已完成", "Completed");
        return <section key={key} aria-label={label} className="agent-directory-group">
          <h3>{label}<span>{items.length}</span></h3>
          {items.length === 0 ? <p>{key === "running" ? tr("暂无运行中的子代理", "No subagents running")
            : tr("暂无已完成的子代理", "No completed subagents yet")}</p> : <ul>
            {items.map(agent => {
              const preview = (agent.status === "failed" && agent.error) || (key === "completed" && agent.finalText)
                || agent.steps.at(-1)?.summary || agent.task || agent.customProfile?.name || agentKindLabel(agent.kind);
              return <li key={agent.id}>
                <button type="button" className="agent-directory-row" onClick={() => onSelect(agent.id)}>
                  <span className="agent-directory-avatar"><AgentAvatar agentId={agent.id} icon={agent.customProfile?.icon} size={32} /></span>
                  <span className="agent-directory-body">
                    <span className="agent-directory-line"><strong className="overflow-fade-text" title={agent.name}>{agent.name}</strong>
                      {agent.updatedAt > 0 && <time>{sideChatTimeLabel(agent.updatedAt, now, locale)}</time>}
                    </span>
                    <span className="agent-directory-line"><span className="agent-directory-preview overflow-fade-text">{preview.slice(0, 256)}</span>
                      <span className={`agent-state is-${agent.status}`}>{agentStateText(agent)}</span>
                    </span>
                  </span>
                  <Icon name="chevron-right" size={14} />
                </button>
              </li>;
            })}
          </ul>}
        </section>;
      })}
    </div>
  </section>;
}
