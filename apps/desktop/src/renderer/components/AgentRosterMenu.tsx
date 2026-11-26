import { isAgentBusy, type AgentControlAction, type AgentInfo } from "@vela/shared";
import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useDismissable } from "../hooks/useDismissable";
import { tr, trf } from "../locale";
import { AgentAvatar } from "./AgentAvatar";
import {
  AgentControls, AgentModelTag, AgentRunStats, AgentStatusMark, AgentTypeLabel, agentStateText, formatTokenCount, useAgentClock,
} from "./AgentPanel";
import { Icon } from "./icons";

/** Shared roster: the agent pane offers run controls; Trace also offers the main agent. */
export function AgentRosterMenu({ agents, activeId, onSelect, onSelectRoot, onControl }: {
  agents: readonly AgentInfo[];
  activeId: string | null;
  onSelect: (agentId: string) => void;
  onSelectRoot?: () => void;
  onControl?: (agentId: string, action: AgentControlAction) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useDismissable<HTMLDivElement>(open, () => setOpen(false));
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const items = useMemo(
    () => agents.filter((item) => item.kind !== "root").sort((a, b) => a.createdAt - b.createdAt),
    [agents],
  );
  const now = useAgentClock(open ? items : []);
  useLayoutEffect(() => {
    if (open) ref.current?.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]')?.focus();
  }, [open, ref]);
  if (!items.length && !onSelectRoot) return null;
  const selected = items.find((item) => item.id === activeId);
  const rootLabel = tr("主代理", "Main agent");
  const label = onSelectRoot ? selected?.name ?? rootLabel : tr("子代理面板", "Subagents panel");
  const active = items.filter((item) => isAgentBusy(item.status)).length;
  const totalTokens = items.reduce((sum, item) => sum + item.usage.total, 0);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  return (
    <div className="agent-roster-menu-anchor" ref={ref}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
      <button ref={trigger}
        className={onSelectRoot ? "trace-agent-trigger" : `view-icon-btn${open ? " active" : ""}`}
        type="button" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
        title={label} aria-label={label} disabled={!items.length}
        onKeyDown={(event) => { if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); } }}
        onClick={() => setOpen((value) => !value)}
      >
        {onSelectRoot ? <>
          {selected ? <AgentAvatar agentId={selected.id} icon={selected.customProfile?.icon} /> : <Icon name="sparkles" size={14} />}
          <span className="overflow-fade-text">{label}</span>
          {items.length > 0 && <Icon name="chevron-down" size={12} />}
        </> : <Icon name="branch" size={14} />}
      </button>
      {open && items.length > 0 ? (
        <div className="agent-roster-menu" id={listId} role="listbox" aria-label={onSelectRoot ? tr("选择代理", "Select agent") : tr("子代理列表", "Subagent list")}
          onKeyDown={(event) => {
            if (event.key === "Escape") { event.stopPropagation(); close(); return; }
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]'));
            const index = options.indexOf(document.activeElement as HTMLButtonElement);
            const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
              : (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
            options[next]?.focus();
          }}>
          {onSelectRoot && <div className={`agent-roster-row trace-root-option${!selected ? " is-active" : ""}`}>
            <button type="button" className="agent-roster-menu-item" role="option" aria-selected={!selected}
              onClick={() => { close(); onSelectRoot(); }}>
              <Icon name="sparkles" size={16} />{rootLabel}
            </button>
          </div>}
          <div className="agent-roster-summary">
            <span>{trf("{0} 个子代理 · {1} 个进行中", "{0} subagents · {1} active", items.length, active)}</span>
            <span className="agent-run-stat" title={tr("所有子代理累计 token", "Total tokens across all subagents")}>
              {formatTokenCount(totalTokens)} tok
            </span>
          </div>
          {items.map((item) => (
            <div key={item.id} className={`agent-roster-row${item.id === activeId ? " is-active" : ""}`}
              style={{ paddingLeft: 10 + Math.max(0, item.depth - 1) * 14 }}>
              <button className="agent-roster-menu-item" type="button" role="option" title={item.name}
                aria-selected={item.id === activeId} onClick={() => { close(); onSelect(item.id); }}>
                <AgentAvatar agentId={item.id} icon={item.customProfile?.icon} />
                <AgentStatusMark status={item.status} />
                <span className="agent-roster-menu-name">{item.name}</span>
                <AgentTypeLabel className="agent-roster-menu-meta" kind={item.kind} profile={item.customProfile} />
                <AgentModelTag model={item.model} thinkingLevel={item.effectiveThinkingLevel ?? item.thinkingLevel} />
              </button>
              <div className="agent-roster-row-detail">
                <span className={`agent-state is-${item.status}`}>{agentStateText(item)}</span>
                <AgentRunStats agent={item} now={now} />
                {onControl && <AgentControls agent={item} onControl={onControl} />}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
