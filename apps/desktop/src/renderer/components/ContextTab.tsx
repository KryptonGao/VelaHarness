import { contextCategories, formatTaskBudgetTokens, type ContextCategory, type ContextUsage, type ConversationContextLimit } from "@vela/shared";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { activeIntlLocale, localizeError, tr, trf } from "../locale";
import { ContextLimitControl } from "./settings/ContextLimitControl";

const categoryLabels: Record<ContextCategory, [string, string]> = {
  system: ["系统提示词", "System prompt"],
  tools: ["工具定义", "Tool definitions"],
  rules: ["规则", "Rules"],
  skills: ["Skills", "Skills"],
  conversation: ["对话", "Conversation"],
};

const exact = (value: number) => value.toLocaleString(activeIntlLocale());

function percentOf(value: number, total: number): string {
  if (total <= 0 || value <= 0) return "0%";
  const percent = (value / total) * 100;
  return percent < 1 ? "<1%" : `${Math.round(percent)}%`;
}

function Row({ label, value, hint }: { label: ReactNode; value: ReactNode; hint?: string }) {
  return <li className="ctx-row" title={hint}><span className="ctx-row-label">{label}</span><span className="ctx-row-value">{value}</span></li>;
}

/** 顶栏「上下文」标签页:当前对话的上下文占用明细,以及只对这个对话生效的长度上限。 */
export function ContextTab({ conversationId, context }: { conversationId: string | null; context: ContextUsage | null | undefined }) {
  const [limit, setLimit] = useState<ConversationContextLimit | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const api = window.vela;
    if (!api || !conversationId) return;
    let active = true;
    setLimit(null);
    void api.getConversationContextLimit(conversationId).then(
      (loaded) => { if (active) setLimit(loaded); },
      (caught: unknown) => { if (active) setError(localizeError(caught instanceof Error ? caught.message : String(caught))); },
    );
    return () => { active = false; };
  }, [conversationId]);

  const save = useCallback(async (next: { limitTokens: number | null } | null) => {
    const api = window.vela;
    if (!api || !conversationId) return;
    setLimit(await api.setConversationContextLimit(conversationId, next));
    setError(null);
  }, [conversationId]);

  const tokens = context?.tokens ?? 0;
  const contextWindow = context?.contextWindow ?? null;
  const segments = context?.segments;
  const basis = contextWindow && contextWindow > 0 ? Math.max(contextWindow, tokens) : tokens;
  const compactAt = context?.compactAt ?? null;
  const modelWindow = context?.modelContextWindow ?? null;
  const percent = contextWindow ? (tokens / contextWindow) * 100 : null;
  const custom = limit?.override != null;
  const effective = limit?.effective.limitTokens ?? null;
  const exceedsModel = effective !== null && modelWindow !== null && effective >= modelWindow;
  const sessionTokens = context?.sessionTokens ?? null;
  const cacheHit = context?.cacheHitRate ?? null;

  return <div className="tb-tab ctx-tab">
    <div className="tb-inner ctx-inner">
      <header className="tb-header">
        <h2>{tr("上下文", "Context")}</h2>
        <p>{tr("查看当前对话占用了多少上下文，并为这个对话单独限制上下文长度。超过上限前会自动压缩较早的内容。",
          "See how much context this conversation uses and cap its length. Earlier content is compacted automatically before the cap is reached.")}</p>
      </header>

      <div className="ctx-grid">
      <div className="ctx-col">
      <section className="tb-card">
        <div className="tb-card-head"><h3>{tr("占用情况", "Usage")}</h3></div>
        <div className="ctx-summary">
          <strong className={`ctx-percent${(percent ?? 0) >= 80 ? " high" : ""}`}>
            {percent === null ? "—" : percent > 0 && percent < 1 ? "<1%" : `${Math.round(percent)}%`}
          </strong>
          <span className="ctx-total">
            {contextWindow ? `~${exact(tokens)} / ${exact(contextWindow)} tokens` : `~${exact(tokens)} tokens`}
          </span>
        </div>
        <div className="ctx-track" role="img" aria-label={tr("上下文占用分布", "Context usage breakdown")}>
          {contextCategories.map((id) => {
            const value = segments?.[id] ?? 0;
            if (value <= 0 || basis <= 0) return null;
            return <div className={`context-usage-seg ${id}`} key={id} style={{ width: `${(value / basis) * 100}%` }} title={`${tr(...categoryLabels[id])} ${exact(value)}`} />;
          })}
          {compactAt !== null && basis > 0
            ? <i className="ctx-marker" style={{ left: `${Math.min(100, (compactAt / basis) * 100)}%` }} title={trf("约 {0} tokens 时自动压缩", "Compacts at about {0} tokens", exact(compactAt))} />
            : null}
        </div>
        {compactAt !== null ? <p className="tb-note ctx-legend-note"><i className="ctx-marker-sample" />{trf("竖线为自动压缩触发点（约 {0}）", "The line marks where auto-compaction starts (about {0})", formatTaskBudgetTokens(compactAt))}</p> : null}
        <ul className="ctx-list ctx-fill">
          {contextCategories.map((id) => {
            const value = segments?.[id] ?? 0;
            return <Row key={id}
              label={<><span className={`context-usage-swatch ${id}`} />{tr(...categoryLabels[id])}</>}
              value={<><span className="ctx-share">{percentOf(value, tokens)}</span>{exact(value)}</>} />;
          })}
        </ul>
      </section>

      </div>
      <div className="ctx-col">
      <section className="tb-card">
        <div className="tb-card-head"><h3>{tr("详细信息", "Details")}</h3></div>
        <ul className="ctx-list">
          <Row label={tr("模型窗口", "Model window")} value={modelWindow ? `${exact(modelWindow)} tokens` : "—"} />
          <Row label={tr("当前生效窗口", "Effective window")} value={contextWindow ? `${exact(contextWindow)} tokens` : "—"}
            hint={tr("模型窗口与本对话上限中较小的一个", "The smaller of the model window and this chat's limit")} />
          <Row label={tr("自动压缩触发点", "Compaction threshold")} value={compactAt !== null ? `${exact(compactAt)} tokens` : "—"}
            hint={tr("占用超过它时，下一次回复前会压缩较早的内容", "Older content is compacted before the next reply once usage passes this")} />
          <Row label={tr("到压缩点还剩", "Headroom to compaction")} value={compactAt !== null ? `${exact(Math.max(0, compactAt - tokens))} tokens` : "—"} />
          <Row label={tr("对话轮数", "Turns")} value={exact(context?.turnCount ?? 0)} />
          <Row label={tr("步数", "Steps")} value={exact(context?.stepCount ?? 0)} hint={tr("已生成的助手消息数", "Assistant messages generated so far")} />
          <Row label={tr("消息数", "Messages")} value={exact(context?.messageCount ?? 0)} />
          <Row label={tr("工具调用", "Tool calls")} value={exact(context?.toolCallCount ?? 0)} />
          <Row label={tr("本次会话累计 token", "Session tokens billed")} value={sessionTokens !== null ? exact(sessionTokens) : "—"}
            hint={tr("输入、输出与缓存读写合计", "Input, output and cache reads/writes combined")} />
          <Row label={tr("提示词缓存命中率", "Prompt cache hit rate")} value={cacheHit !== null ? `${Math.round(cacheHit * 100)}%` : "—"} />
        </ul>
      </section>

      </div>
      </div>
      <section className="tb-card ctx-limit-card">
        <div className="tb-card-head">
          <h3>{tr("上下文长度上限", "Context limit")}</h3>
          <div className="tb-seg" role="radiogroup" aria-label={tr("上限来源", "Limit source")}>
            {([["custom", tr("本对话自定义", "Custom for this chat")], ["global", tr("沿用全局设置", "Use global setting")]] as const).map(([id, label]) => {
              const active = (custom ? "custom" : "global") === id;
              return <button key={id} type="button" role="radio" aria-checked={active} data-active={active ? "true" : undefined} disabled={!limit}
                onClick={() => {
                  if (!limit || active) return;
                  void save(id === "global" ? null : { limitTokens: limit.effective.limitTokens }).catch((caught: unknown) => setError(localizeError(caught instanceof Error ? caught.message : String(caught))));
                }}>{label}</button>;
            })}
          </div>
        </div>
        {limit && !custom
          ? <p className="tb-note">{trf("沿用全局设置：{0}。可在 设置 › 默认与权限 中修改。", "Using the global setting: {0}. Change it under Settings › Defaults & permissions.",
            limit.global.limitTokens === null ? tr("不限", "No limit") : formatTaskBudgetTokens(limit.global.limitTokens))}</p>
          : null}
        {limit && custom
          ? <ContextLimitControl label={tr("上下文长度上限", "Context limit")} value={limit.effective.limitTokens} onCommit={(limitTokens) => save({ limitTokens })} />
          : null}
        {limit && exceedsModel ? <p className="tb-note">{tr("上限不小于模型自身的窗口，因此不会起到限制作用。", "The limit is not below the model's own window, so it has no effect.")}</p> : null}
        {error ? <p className="settings-error">{error}</p> : null}
      </section>
    </div>
  </div>;
}
