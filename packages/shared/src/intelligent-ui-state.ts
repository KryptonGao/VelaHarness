import {
  isForbiddenKey,
  uiLimits,
  type UiAction,
  type UiArtifact,
  type UiNode,
  type UiScalar,
  type UiSourceDefinition,
  type UiSourceSnapshot,
  type UiStateDefinition,
  type UiValue,
} from "./intelligent-ui";
import { hashUiSource } from "./intelligent-ui-parser";
import { describeSourceProvenance } from "./intelligent-ui-source";
import {
  parseUnifiedDiff,
  resolveChartData,
  resolvePieData,
  resolveTimeline,
  sourceRows,
} from "./intelligent-ui-data";
import {
  evaluateExpression,
  formatNumber,
  resolveUiValue,
  sortDerived,
  type UiEvalEnv,
  type UiEvalErrorCode,
  type UiEvalResult,
} from "./intelligent-ui-expression";

/**
 * 本地 UI 状态：初始值、输入校验、派生值求值和面向模型/导出的文字化。
 * 全部是纯函数，Renderer、Main（导出）和测试共用同一份逻辑。
 */

export type UiStateValues = Readonly<Record<string, UiValue>>;

export type UiInputError = "required" | "not_a_number" | "below_min" | "above_max" | "too_long" | "not_an_option" | "wrong_type";

export function initialUiValues(artifact: Pick<UiArtifact, "stateDefinitions">): Record<string, UiValue> {
  const values: Record<string, UiValue> = {};
  for (const definition of artifact.stateDefinitions) values[definition.name] = definition.initial;
  return values;
}

/** 校验一个输入值。null 表示合法。 */
export function validateStateValue(definition: UiStateDefinition, value: UiValue | undefined): UiInputError | null {
  if (definition.kind === "number") {
    if (value === null || value === undefined) return "required";
    if (typeof value !== "number" || !Number.isFinite(value)) return "not_a_number";
    if (definition.min !== undefined && value < definition.min) return "below_min";
    if (definition.max !== undefined && value > definition.max) return "above_max";
    return null;
  }
  if (definition.kind === "boolean") return typeof value === "boolean" ? null : "wrong_type";
  if (typeof value !== "string") return "wrong_type";
  if (value.length > (definition.maxLength ?? 200)) return "too_long";
  if (definition.options && !definition.options.includes(value)) return "not_an_option";
  return null;
}

/**
 * 把保存的快照恢复进来：类型不对或选项已不存在就退回初始值。
 * 允许保留「用户清空了数字框」这类中间态（number 状态可以是 null）。
 */
export function restoreUiValues(artifact: Pick<UiArtifact, "stateDefinitions">, saved: unknown): Record<string, UiValue> {
  const values = initialUiValues(artifact);
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return values;
  for (const definition of artifact.stateDefinitions) {
    if (!Object.prototype.hasOwnProperty.call(saved, definition.name)) continue;
    const value = (saved as Record<string, unknown>)[definition.name];
    if (definition.kind === "number" && (value === null || (typeof value === "number" && Number.isFinite(value)))) values[definition.name] = value;
    else if (definition.kind === "boolean" && typeof value === "boolean") values[definition.name] = value;
    else if (definition.kind === "string" && typeof value === "string" && value.length <= (definition.maxLength ?? 200) &&
      (!definition.options || definition.options.includes(value))) values[definition.name] = value;
  }
  return values;
}

/** 数据源的标量结果进入表达式环境；没有可用数据时给出具体的原因而不是静默当作 0。 */
function sourceEnvResult(snapshot: UiSourceSnapshot | undefined): UiEvalResult {
  if (!snapshot || snapshot.status === "loading") return { ok: false, error: "source_pending" };
  if (snapshot.status === "error") return { ok: false, error: "source_failed" };
  if (snapshot.status === "empty") return { ok: false, error: "source_empty" };
  if (snapshot.scalar !== undefined) return { ok: true, value: snapshot.scalar };
  return { ok: false, error: "type_mismatch" };
}

export type UiEnvArtifact = Pick<UiArtifact, "stateDefinitions" | "derived" | "derivedOrder" | "status"> & { sources?: readonly UiSourceDefinition[] };

/** 构建求值环境：先放状态（非法输入变成 invalid_input）和数据源结果，再按拓扑顺序算派生值。 */
export function buildUiEnv(artifact: UiEnvArtifact, values: UiStateValues, snapshots?: ReadonlyMap<string, UiSourceSnapshot>): UiEvalEnv {
  const env = new Map<string, UiEvalResult>();
  for (const definition of artifact.stateDefinitions) {
    const value = values[definition.name];
    if (validateStateValue(definition, value) !== null) env.set(definition.name, { ok: false, error: "invalid_input" });
    else env.set(definition.name, { ok: true, value: value as UiScalar });
  }
  for (const definition of artifact.sources ?? []) env.set(definition.name, sourceEnvResult(snapshots?.get(definition.name)));
  const receiving = artifact.status === "receiving";
  let order = artifact.derivedOrder;
  if (order.length !== artifact.derived.length) {
    // commit 之前依赖可能还没到齐：尽力排序，排不出来就先标记为等待中。
    const known = new Set([...artifact.stateDefinitions.map(definition => definition.name), ...(artifact.sources ?? []).map(definition => definition.name)]);
    const sorted = sortDerived(known, artifact.derived);
    order = sorted.ok ? sorted.order : [];
  }
  const byName = new Map(artifact.derived.map(item => [item.name, item] as const));
  for (const name of order) {
    const result = evaluateExpression(byName.get(name)!.expression, env);
    env.set(name, receiving && !result.ok && result.error === "unknown_ref" ? { ok: false, error: "pending_ref" } : result);
  }
  for (const item of artifact.derived) {
    if (!env.has(item.name)) env.set(item.name, { ok: false, error: receiving ? "pending_ref" : "unknown_ref" });
  }
  return env;
}

/** show 条件：没有条件即显示；条件必须算出 true，出错一律隐藏。 */
export function isUiNodeVisible(node: Pick<UiNode, "show">, env: UiEvalEnv): boolean {
  if (node.show === undefined) return true;
  const result = evaluateExpression(node.show, env);
  return result.ok && result.value === true;
}

/** 显示用的数字格式：给了 digits 就固定位数，否则最多 6 位小数并去掉多余的 0。 */
export function formatUiNumber(value: number, digits?: number): string {
  if (digits !== undefined) {
    const formatted = formatNumber(value, digits, "number");
    return formatted.ok ? String(formatted.value) : String(value);
  }
  const formatted = formatNumber(value, 6, "number");
  if (!formatted.ok) return String(value);
  const text = String(formatted.value);
  return text.includes(".") ? text.replace(/\.?0+$/, "") : text;
}

export function formatUiScalar(value: UiScalar, digits?: number): string {
  if (value === null) return "";
  if (typeof value === "number") return formatUiNumber(value, digits);
  if (typeof value === "boolean") return value ? "true" : "false";
  return value;
}

// ---------- 文字化：提交给 Agent 与导出 ----------

function labelFor(artifact: UiArtifact, name: string): string {
  for (const node of artifact.nodes) {
    if (node.props.bind === name && typeof node.props.label === "string") return node.props.label;
  }
  return name;
}

function describeValue(artifact: UiArtifact, name: string, values: UiStateValues): string {
  const definition = artifact.stateDefinitions.find(item => item.name === name);
  const value = values[name];
  if (!definition) return "";
  if (definition.kind === "boolean") return value === true ? "yes" : "no";
  if (value === null || value === undefined) return "(empty)";
  if (definition.kind === "string") {
    // 选项类状态给出显示标签，比内部值更容易被模型读懂。
    for (const node of artifact.nodes) {
      if (node.props.bind !== name || !Array.isArray(node.props.options)) continue;
      const option = (node.props.options as Array<{ value: string; label: string }>).find(item => item.value === value);
      if (option && option.label !== option.value) return `${option.label} (${option.value})`;
    }
  }
  return formatUiScalar(value as UiScalar);
}

/**
 * 「继续交给 Agent」要发送的完整文字。预览与实际发送用同一个函数，所以用户看到的就是发出去的。
 * include 缺省表示全部状态。
 */
export function composeUiSubmission(
  artifact: UiArtifact,
  action: Extract<UiAction, { type: "submit_to_agent" }>,
  values: UiStateValues,
): string {
  const names = (action.include ?? artifact.stateDefinitions.map(item => item.name))
    .filter(name => artifact.stateDefinitions.some(item => item.name === name));
  const lines = names.map(name => `- ${labelFor(artifact, name)} (${name}): ${describeValue(artifact, name, values)}`);
  const header = artifact.title ? `[${artifact.title}]` : "";
  const body = lines.length ? `${action.text}\n\nCurrent parameters${header ? ` ${header}` : ""}:\n${lines.join("\n")}` : action.text;
  return body.slice(0, uiLimits.textLength);
}

function plainText(value: unknown, env: UiEvalEnv): string {
  const result = resolveUiValue(value, env);
  return result.ok ? formatUiScalar(result.value) : "";
}

export type UiSnapshots = ReadonlyMap<string, UiSourceSnapshot>;

/** 带单位、前缀的数值文字。 */
function measure(value: number | null, props: Record<string, unknown>): string {
  if (value === null) return "—";
  return `${props.prefix ?? ""}${formatUiNumber(value, props.digits as number | undefined)}${props.unit ? ` ${String(props.unit)}` : ""}`;
}

/** 数据来源行：真实工具来源带 id 和时间；模型自己写的来源永远标注「未验证」。 */
function provenanceLine(props: Record<string, unknown>, snapshots: UiSnapshots | undefined): string | null {
  const parts: string[] = [];
  if (typeof props.from === "string") {
    const snapshot = snapshots?.get(props.from);
    parts.push(snapshot ? `Data: ${describeSourceProvenance(snapshot)}` : `Data: ${props.from} (not available)`);
  }
  const note = props.source as { label?: string; url?: string } | undefined;
  if (note?.label) parts.push(`Source (unverified): ${note.label}${note.url ? ` <${note.url}>` : ""}`);
  if (typeof props.status === "string" && props.status !== "ok") parts.push(`Status: ${props.status}`);
  return parts.length ? `*${parts.join(" · ")}*` : null;
}

function mdCell(value: UiScalar): string {
  return formatUiScalar(value).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/** 交互 UI 的纯文字等价物：导出和「查看文字」使用，不含任何可执行内容。 */
export function summarizeUiArtifact(artifact: UiArtifact, values: UiStateValues = initialUiValues(artifact), snapshots?: UiSnapshots): string {
  if (artifact.status === "invalid" || artifact.status === "disposed" || !artifact.rootNodeId) return "";
  const env = buildUiEnv(artifact, values, snapshots);
  const byId = new Map(artifact.nodes.map(node => [node.id, node] as const));
  const lines: string[] = [];
  if (artifact.title) lines.push(`**${artifact.title}**`);
  const walk = (node: UiNode): void => {
    if (node.invalid || !isUiNodeVisible(node, env)) return;
    const props = node.props;
    const visit = () => node.childrenIds.forEach(id => { const child = byId.get(id); if (child) walk(child); });
    const provenance = () => { const line = provenanceLine(props, snapshots); if (line) lines.push(line); };
    const snapshot = typeof props.from === "string" ? snapshots?.get(props.from) : undefined;
    switch (node.type) {
      case "heading": lines.push(`### ${plainText(props.text, env)}`); break;
      case "text": case "caption": lines.push(plainText(props.text, env)); break;
      case "code": lines.push("```", String(props.code ?? ""), "```"); break;
      case "card": if (props.title) lines.push(`**${String(props.title)}**`); visit(); break;
      case "collapsible": lines.push(`**${String(props.title ?? "")}**`); visit(); break;
      case "stat": {
        const result = resolveUiValue(props.value, env);
        const value = result.ok ? formatUiScalar(result.value, props.digits as number | undefined) : "(unavailable)";
        lines.push(`${String(props.label)}: ${props.prefix ?? ""}${value}${props.unit ? ` ${String(props.unit)}` : ""}`);
        provenance();
        break;
      }
      case "progress": {
        const result = resolveUiValue(props.value, env);
        lines.push(`${String(props.label)}: ${result.ok ? formatUiScalar(result.value) : "(unavailable)"} / ${String(props.max)}${props.unit ? ` ${String(props.unit)}` : ""}`);
        provenance();
        break;
      }
      case "list": {
        const items = typeof props.from === "string"
          ? sourceRows(snapshot).map(row => ({ text: formatUiScalar(row[String(props.textKey)] ?? null), detail: typeof props.detailKey === "string" ? formatUiScalar(row[props.detailKey] ?? null) || null : null }))
          : (props.items as Array<{ text: string; detail: string | null }>) ?? [];
        items.forEach((item, index) => lines.push(`${props.ordered ? `${index + 1}.` : "-"} ${item.text}${item.detail ? ` — ${item.detail}` : ""}`));
        provenance();
        break;
      }
      case "table": {
        const columns = props.columns as Array<{ key: string; label: string }>;
        const rows = typeof props.from === "string"
          ? sourceRows(snapshot).map(row => ({ cells: row as Record<string, UiScalar> }))
          : props.rows as Array<{ cells: Record<string, UiScalar> }>;
        if (props.caption) lines.push(`*${String(props.caption)}*`);
        lines.push(`| ${columns.map(column => mdCell(column.label)).join(" | ")} |`);
        lines.push(`| ${columns.map(() => "---").join(" | ")} |`);
        for (const row of rows) lines.push(`| ${columns.map(column => mdCell(row.cells[column.key] ?? null)).join(" | ")} |`);
        provenance();
        break;
      }
      case "bar_chart": case "line_chart": {
        const data = resolveChartData(props, env, snapshot);
        if (props.title) lines.push(`**${String(props.title)}**`);
        if (props.caption) lines.push(`*${String(props.caption)}*`);
        lines.push(`| | ${data.series.map(entry => mdCell(entry.label || "—")).join(" | ")} |`);
        lines.push(`| --- | ${data.series.map(() => "---").join(" | ")} |`);
        data.labels.forEach((label, index) => lines.push(`| ${mdCell(label)} | ${data.series.map(entry => measure(entry.values[index] ?? null, props)).join(" | ")} |`));
        provenance();
        break;
      }
      case "pie_chart": {
        const data = resolvePieData(props, env, snapshot);
        if (props.title) lines.push(`**${String(props.title)}**`);
        for (const slice of data.slices) lines.push(`- ${slice.label}: ${measure(slice.value, props)} (${(slice.fraction * 100).toFixed(1)}%)`);
        provenance();
        break;
      }
      case "svg_diagram": {
        lines.push(`**${String(props.title)}**`);
        if (props.description) lines.push(String(props.description));
        const hotspots = (props.hotspots as Array<{ label: string; description?: string; value: string }>) ?? [];
        const current = typeof props.bind === "string" ? values[props.bind] : undefined;
        for (const hotspot of hotspots) lines.push(`- ${hotspot.label}${hotspot.description ? `: ${hotspot.description}` : ""}${hotspot.value === current ? " (selected)" : ""}`);
        const labels = ((props.shapes as Array<{ type: string; text?: string }>) ?? []).filter(shape => shape.type === "text" && shape.text).map(shape => shape.text);
        if (labels.length) lines.push(`Labels: ${labels.join(", ")}`);
        break;
      }
      case "media": lines.push(`[${String(props.kind)}] ${String(props.alt)}${props.caption ? ` — ${String(props.caption)}` : ""}`); provenance(); break;
      case "timeline": {
        if (props.title) lines.push(`**${String(props.title)}**`);
        for (const entry of resolveTimeline(props, snapshot)) lines.push(`- ${entry.date ? `${entry.date} · ` : ""}${entry.title} [${entry.status}]${entry.detail ? ` — ${entry.detail}` : ""}`);
        provenance();
        break;
      }
      case "itinerary": {
        if (props.title) lines.push(`**${String(props.title)}**`);
        for (const day of props.days as Array<{ label: string; stops: Array<{ name: string; time?: string; note?: string; lat?: number; lng?: number }> }>) {
          lines.push(`**${day.label}**`);
          for (const stop of day.stops) {
            const place = typeof stop.lat === "number" && typeof stop.lng === "number" ? ` (${stop.lat}, ${stop.lng}, coordinates given by the model)` : "";
            lines.push(`- ${stop.time ? `${stop.time} · ` : ""}${stop.name}${place}${stop.note ? ` — ${stop.note}` : ""}`);
          }
        }
        provenance();
        break;
      }
      case "diff_view": {
        const text = typeof props.from === "string" ? (snapshot?.text ?? "") : String(props.diff ?? "");
        const model = parseUnifiedDiff(text, 400);
        if (props.caption) lines.push(`*${String(props.caption)}*`);
        lines.push(`${props.fileName ? `${String(props.fileName)}: ` : ""}+${model.added} −${model.removed}`);
        lines.push("```diff", ...model.lines.map(line => `${line.kind === "add" ? "+" : line.kind === "del" ? "-" : line.kind === "ctx" ? " " : ""}${line.text}`), "```");
        provenance();
        break;
      }
      case "tabs": case "segmented": case "select": case "radio": case "input": case "number_input": case "slider": case "checkbox": {
        const name = String(props.bind);
        lines.push(`${String(props.label)}: ${describeValue(artifact, name, values)}${props.unit ? ` ${String(props.unit)}` : ""}`);
        if (node.type === "tabs") visit();
        break;
      }
      case "empty": case "error": lines.push(`${String(props.title)}${props.description ? ` — ${String(props.description)}` : ""}`); break;
      case "column": case "row": case "grid": visit(); break;
      default: break;
    }
  };
  const root = byId.get(artifact.rootNodeId);
  if (root) walk(root);
  if (artifact.status !== "ready") lines.push("(incomplete)");
  return lines.join("\n");
}

// ---------- 提交给 Agent 的两种建议动作（IUI-11 / IUI-16） ----------

export type UiRequestResult = { ok: true; text: string } | { ok: false; error: UiEvalErrorCode };

/**
 * 「建议运行一个工具」要发送的文字。界面不执行工具：用户确认后这只是一条普通消息，
 * 是否运行、是否需要审批完全由 Agent Runtime 决定；文字里明确说明它不是预先批准。
 */
export function composeToolRequest(
  artifact: Pick<UiArtifact, "title">,
  action: Extract<UiAction, { type: "request_tool" }>,
  env: UiEvalEnv,
): UiRequestResult {
  const args: string[] = [];
  for (const [name, value] of Object.entries(action.args ?? {})) {
    const result = resolveUiValue(value, env);
    if (!result.ok) return { ok: false, error: result.error };
    args.push(`- ${name}: ${formatUiScalar(result.value) || "(empty)"}`);
  }
  const header = artifact.title ? `[Interface suggestion: ${artifact.title}]` : "[Interface suggestion]";
  const body = [
    `${header} Please consider running the \`${action.tool}\` tool: ${action.summary}`,
    ...(args.length ? ["Suggested arguments:", ...args] : []),
    "This came from a button in an interface, not from an approval. Apply the normal tool permissions and ask me if anything needs confirmation.",
  ].join("\n");
  return { ok: true, text: body.slice(0, uiLimits.textLength) };
}

/**
 * 「按当前设置继续」（IUI-12）：把界面当前的全部参数交还给 Agent。
 * 和 submit_to_agent 共用同一个排版函数，预览与实际发送一致；用户确认后才会发出。
 */
export function composeContinueRequest(artifact: UiArtifact, values: UiStateValues): string {
  return composeUiSubmission(artifact, { type: "submit_to_agent", text: "Continue with the current settings from the interface." }, values);
}

/** 刷新数据源：请 Agent 重新运行当时的工具，再更新界面。界面自己不抓取任何数据。 */
export function composeRefreshRequest(
  artifact: Pick<UiArtifact, "title">,
  definition: UiSourceDefinition,
  snapshot: UiSourceSnapshot | undefined,
): string {
  const subject = snapshot?.subject ? ` (${snapshot.subject})` : "";
  const header = artifact.title ? ` for the interface "${artifact.title}"` : "";
  return [
    `Please refresh the data source "${definition.name}"${header}: run the \`${definition.tool}\` tool again${subject} and update the interface with the new result.`,
    "Use the normal tool permissions.",
  ].join("\n").slice(0, uiLimits.textLength);
}

// ---------- 本地状态快照：键与格式（Renderer 写入，导出等 Main 侧功能读取） ----------

export const uiStateVersion = 1;

/** conversationId + 稳定消息位置（u0、u1…）+ artifactId。 */
export interface UiStateScope {
  conversationId: string;
  messageId: string;
  artifactId: string;
}

export const uiStateKeyPrefix = "vela.ui";

export function uiStateStorageKey(scope: UiStateScope): string {
  return `${uiStateKeyPrefix}.state.${scope.conversationId}.${scope.messageId}.${scope.artifactId}`;
}

/** 内容指纹：同一位置的界面被改写后，旧快照因指纹不符被丢弃。 */
export function uiSourceFingerprint(artifactId: string, raw: string): string {
  return hashUiSource(`${artifactId}\n${raw}`);
}

/** 解析保存的快照；版本、指纹或结构不符返回 null，并剔除原型污染键。 */
export function parseUiStateSnapshot(raw: string | null | undefined, fingerprint: string): Record<string, UiValue> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as { v?: unknown; hash?: unknown; values?: unknown };
    if (record.v !== uiStateVersion || record.hash !== fingerprint) return null;
    if (!record.values || typeof record.values !== "object" || Array.isArray(record.values)) return null;
    return Object.fromEntries(Object.entries(record.values as Record<string, unknown>).filter(([key]) => !isForbiddenKey(key))) as Record<string, UiValue>;
  } catch {
    return null;
  }
}

export function serializeUiStateSnapshot(fingerprint: string, values: Record<string, UiValue>): string {
  return JSON.stringify({ v: uiStateVersion, hash: fingerprint, values });
}
