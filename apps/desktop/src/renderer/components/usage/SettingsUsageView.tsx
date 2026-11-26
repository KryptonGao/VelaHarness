import { useId, useMemo, useState } from "react";
import type { ConversationSummary, ModelSummary, ProviderSummary } from "@vela/shared";
import { useCodexAppUsage } from "../../hooks/useCodexAppUsage";
import { codexUsageRecord } from "./codex-usage-model";
import { SettingsBlock, SettingsGroup, SettingsSwitch } from "../settings/primitives";
import { useUsageHistory } from "../../hooks/useUsageHistory";
import { tr, trf, useAppLocale } from "../../locale";
import { ModelPricingEditor, type PriceableModel } from "./ModelPricingEditor";
import { UsageReport } from "./UsageView";
import { SettingsSelect } from "../settings/SettingsSelect";
import { filterUsageRequests, requestDate, summarizeUsage, usageDateKey } from "./usage-model";

type Range = "all" | "30" | "7" | "custom";

export function SettingsUsageView({ conversations, providers, models = [] }: {
  conversations: ConversationSummary[];
  providers: Pick<ProviderSummary, "id" | "name" | "authenticated">[];
  models?: Pick<ModelSummary, "provider" | "providerName" | "id" | "name">[];
}) {
  const id = useId();
  const codex = useCodexAppUsage();
  useAppLocale();
  const imported = useMemo(() => codex.report.buckets.map(codexUsageRecord), [codex.report.buckets]);
  const [source, setSource] = useState("");
  const showVela = !codex.enabled || source !== "codex";
  const showCodex = codex.enabled && source !== "vela";
  const history = useUsageHistory(showVela ? conversations : []);
  const [range, setRange] = useState<Range>("30");
  const [selectedProviders, setSelectedProviders] = useState<string[]>([]);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const today = usageDateKey(new Date());
  const firstDay = new Date(`${today}T12:00:00`);
  firstDay.setDate(firstDay.getDate() - (range === "7" ? 6 : 29));
  const filterStart = range === "all" ? "" : range === "custom" ? start : usageDateKey(firstDay);
  const filterEnd = range === "all" ? "" : range === "custom" ? end : today;
  const invalidRange = range === "custom" && Boolean(start && end && start > end);
  const filter = useMemo(() => ({ providers: selectedProviders, start: filterStart, end: filterEnd }),
    [selectedProviders, filterStart, filterEnd]);
  const requests = useMemo(() => invalidRange ? [] : filterUsageRequests(history.requests, filter),
    [history.requests, filter, invalidRange]);
  const summaryRequests = useMemo(() => invalidRange ? [] : filterUsageRequests(history.summaryRequests, filter),
    [history.summaryRequests, filter, invalidRange]);
  const agentRequests = useMemo(() => invalidRange ? [] : filterUsageRequests(history.agentRequests, filter),
    [history.agentRequests, filter, invalidRange]);
  const filteredImported = useMemo(() => invalidRange || !showCodex ? [] : filterUsageRequests(imported, filter),
    [imported, showCodex, invalidRange, filter]);
  const available = useMemo(() => summarizeUsage([...history.requests, ...history.agentRequests, ...history.summaryRequests,
    ...(showCodex ? imported : [])]).providers, [history.requests, history.agentRequests, history.summaryRequests, showCodex, imported]);
  const missingDates = history.requests.filter(request => requestDate(request) === null).length
    + (showCodex ? imported.reduce((n, r) => n + (r.startedAt === null ? r.requestCount ?? 1 : 0), 0) : 0);
  const providerNames = new Map(providers.map(item => [item.id, item.name]));
  providerNames.set("?", tr("未知提供方", "Unknown provider"));
  const priceable = useMemo(() => {
    const loggedIn = new Set(providers.filter(p => p.authenticated).map(p => p.id));
    const choices = new Map<string, PriceableModel>();
    for (const m of models) {
      const key = `${m.provider}/${m.id}`;
      if (loggedIn.has(m.provider)) choices.set(key, { key, modelKey: key, group: m.providerName, label: m.name });
    }
    for (const r of imported) {
      if (r.priceKey && !choices.has(r.priceKey)) choices.set(r.priceKey, {
        key: r.priceKey, modelKey: r.model, tier: r.tier,
        group: `Codex App · ${r.model.split("/")[0]}`, label: r.displayModel,
      });
    }
    return [...choices.values()];
  }, [models, providers, imported]);
  const syncLabel = tr("同步本机 Codex App 用量", "Sync local Codex App usage");
  const changeSource = (value: string) => { setSource(value); setSelectedProviders([]); };
  const toggleProvider = (value: string) => {
    if (!value) return setSelectedProviders([]);
    setSelectedProviders(current => current.includes(value)
      ? current.filter(provider => provider !== value)
      : [...current, value]);
  };
  return <section className="settings-usage" data-setting-id="usage" aria-label={tr("使用统计", "Usage statistics")}>
    <div className="usage-heading">
      <div>
        <p className="usage-note">{tr("汇总本地所有对话（含归档）的模型请求与 Token 用量。缺失的用量不会显示为零。", "Model requests and token usage across all local conversations, including archived chats. Missing usage is never shown as zero.")}</p>
      </div>
      <button type="button" className="settings-secondary" onClick={() => { history.refresh(); if (codex.enabled) codex.refresh(); }}
        disabled={history.loading || codex.loading}>
        {tr("刷新", "Refresh")}
      </button>
    </div>
    {codex.failed ? <p className="usage-warning" role="alert">{tr("Codex App 用量同步失败，请重试。", "Could not sync Codex App usage. Try again.")}</p> : null}
    {showCodex && codex.loading ? <p className="usage-note" role="status">{tr("正在同步 Codex App 用量…", "Syncing Codex App usage…")}</p> : null}
    {showCodex && !codex.loading && !codex.failed && imported.length === 0 ? <p className="usage-note" role="status">
      {tr("尚未找到本机 Codex 桌面会话的用量记录。", "No metered local Codex desktop sessions found.")}
    </p> : null}
    <div className="usage-filters">
      {codex.enabled ? <label className="usage-provider-filter">{tr("来源", "Source")}
        <SettingsSelect label={tr("来源", "Source")} value={source} onChange={changeSource}
          options={[{ value: "", label: tr("全部", "All") }, { value: "vela", label: "Vela" }, { value: "codex", label: "Codex App" }]} />
      </label> : null}
      <label className="usage-provider-filter">{tr("提供方", "Provider")}
        <SettingsSelect
          multiple
          label={tr("提供方", "Provider")}
          value={selectedProviders.length ? selectedProviders : [""]}
          onToggle={toggleProvider}
          options={[
            { value: "", label: tr("全部", "All") },
            ...available.filter(item => item.provider).map(item => ({ value: item.provider, label: providerNames.get(item.provider) ?? item.provider })),
          ]}
        />
      </label>
      <div className="usage-range" role="group" aria-label={tr("时间范围", "Date range")}>
        {([ ["all", tr("可用历史", "All history")], ["30", tr("30 天", "30 days")],
          ["7", tr("7 天", "7 days")], ["custom", tr("自定义", "Custom")] ] as const).map(([key, label]) =>
          <button key={key} type="button" aria-pressed={range === key} onClick={() => setRange(key)}>{label}</button>)}
      </div>
    </div>
    {range === "custom" ? <div className="usage-date-range">
      <label>{tr("开始日期", "Start date")}<input type="date" value={start} onChange={event => setStart(event.target.value)}
        onInput={event => setStart(event.currentTarget.value)}
        aria-invalid={invalidRange} aria-describedby={invalidRange ? `${id}-range-error` : undefined} /></label>
      <label>{tr("结束日期", "End date")}<input type="date" value={end} onChange={event => setEnd(event.target.value)}
        onInput={event => setEnd(event.currentTarget.value)}
        aria-invalid={invalidRange} aria-describedby={invalidRange ? `${id}-range-error` : undefined} /></label>
      {invalidRange ? <p className="usage-warning" id={`${id}-range-error`} role="alert">{tr("结束日期不能早于开始日期。", "The end date must be on or after the start date.")}</p> : null}
    </div> : null}
    {history.failed || history.warnings ? <p className="usage-warning" role="status">
      {trf("{0} 个对话加载失败，{1} 个对话的记录不完整；当前统计可能不完整，可点击刷新重试。", "{0} conversations failed to load; {1} have incomplete records. Statistics may be incomplete. Refresh to retry.", history.failed, history.warnings)}
    </p> : null}
    {missingDates > 0 && (filterStart || filterEnd) ? <p className="usage-note">
      {trf("{0} 个请求缺少日期，未纳入日期筛选；可在「可用历史」中查看。", "{0} undated requests are excluded from date filters. Select All history to include them.", missingDates)}
    </p> : null}
    <UsageReport requests={requests} imported={filteredImported} agentRequests={agentRequests} summaries={summaryRequests} providers={providers} loading={history.loading} settings
      start={filterStart} end={filterEnd} />
    <ModelPricingEditor candidates={priceable} />
    <SettingsGroup>
      <SettingsBlock layout="inline" title={syncLabel}
        hint={tr("仅统计本机桌面会话及归档中有计量记录的请求。费用按登记单价估算。", "Includes metered requests from local desktop sessions and archives. Costs are estimated using registered prices.")}>
        <SettingsSwitch label={syncLabel} checked={codex.enabled} onChange={next => { codex.toggle(next); changeSource(""); }} />
      </SettingsBlock>
    </SettingsGroup>
    {showCodex && codex.showIncompleteWarning ? <div className="usage-warning usage-incomplete-warning">
      <span role="status">{trf("{0} 个 Codex 文件的计量记录不完整，统计仅包含可恢复的用量。", "{0} Codex files have incomplete metering records. Totals include recoverable usage.", codex.report.incompleteFiles)}</span>
      <button type="button" className="settings-secondary" onClick={codex.dismissIncompleteWarning}>{tr("忽略", "Ignore")}</button>
    </div> : null}
  </section>;
}
