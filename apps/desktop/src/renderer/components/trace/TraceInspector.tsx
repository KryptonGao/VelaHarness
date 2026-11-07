import { traceCodePages } from "./trace-model";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type {
  TraceDetails,
  TraceKind,
  TraceNode,
  TraceStatus,
} from "@vela/shared";
import { highlightSnippet, type ThemedToken } from "../preview/highlighter";
import { Markdown } from "../Markdown";
import { tr, trf } from "../../locale";
import { useSlidingTabIndicator } from "../useSlidingTabIndicator";

export const kindLabel = (kind: TraceKind) =>
  ({
    system: tr("系统", "System"),
    user: tr("用户", "User"),
    thinking: tr("思考", "Thinking"),
    assistant: tr("助手", "Assistant"),
    "tool-call": tr("工具调用", "Tool call"),
    "tool-result": tr("工具返回", "Tool result"),
    error: tr("异常", "Error"),
    state: tr("系统状态", "System state"),
  })[kind];
export const statusLabel = (status: TraceStatus) =>
  ({
    Running: tr("执行中", "Running"),
    Completed: tr("已完成", "Completed"),
    Failed: tr("失败", "Failed"),
    Interrupted: tr("已中断", "Interrupted"),
  })[status];
export const durationLabel = (ms: number | null) =>
  ms === null
    ? tr("未记录", "Not recorded")
    : ms < 1000
      ? `${Math.round(ms).toLocaleString()} ms`
      : `${(ms / 1000).toFixed(2)} s`;
export const timeLabel = (time: number | null) =>
  time === null
    ? tr("未记录", "Not recorded")
    : `${new Date(time).toLocaleString(undefined, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}.${String(new Date(time).getMilliseconds()).padStart(3, "0")}`;
export const stringify = (value: unknown) =>
  typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? "");
const resultText = (value: unknown) =>
  value &&
  typeof value === "object" &&
  "content" in value &&
  Array.isArray(value.content)
    ? value.content
        .map((p) => (p.type === "text" ? p.text : `[${p.type}]`))
        .join("\n")
    : stringify(value);

export function TraceIcon({
  kind,
  size = 14,
}: {
  kind: TraceKind;
  size?: number;
}) {
  // 16px grid, round caps, at most one small filled accent per icon.
  const paths: Record<TraceKind, ReactNode> = {
    user: (
      <>
        <circle cx="8" cy="5.4" r="2.6" />
        <path d="M2.9 13.6c.5-2.6 2.5-4 5.1-4s4.6 1.4 5.1 4" />
      </>
    ),
    assistant: (
      <>
        <path d="M3.5 2.5h9a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5H8.2L5 14.2v-2.7H3.5A1.5 1.5 0 0 1 2 10V4a1.5 1.5 0 0 1 1.5-1.5Z" />
        <path d="M8 4.5 8.8 6.4 10.7 7.2 8.8 8 8 9.9 7.2 8 5.3 7.2 7.2 6.4Z" fill="currentColor" strokeWidth="1" />
      </>
    ),
    thinking: (
      <>
        <path d="M4.6 10.2A2.9 2.9 0 0 1 4.2 4.5a3.4 3.4 0 0 1 6.4-.5 2.7 2.7 0 0 1 1.5 5.2 2.9 2.9 0 0 1-2 1H5.8a1.7 1.7 0 0 1-1.2-.1Z" />
        <circle cx="4.3" cy="13" r="1.1" fill="currentColor" stroke="none" />
        <circle cx="2.2" cy="14.7" r=".7" fill="currentColor" stroke="none" />
      </>
    ),
    "tool-call": (
      <path d="M10.3 2.3a3.5 3.5 0 0 0-3.2 4.8L2.8 11.4a1.5 1.5 0 0 0 2.1 2.1l4.3-4.3a3.5 3.5 0 0 0 4.8-3.2l-2.1 2.1-1.9-.4-.4-1.9 2.1-2.1a3.5 3.5 0 0 0-1.4-.4Z" />
    ),
    "tool-result": (
      <>
        <path d="M13 3.5V8a2 2 0 0 1-2 2H3.5" />
        <path d="m6.3 6.9-2.9 3.1 2.9 3.1" />
      </>
    ),
    error: (
      <>
        <path d="M6.9 2.9 1.9 11.6a1.3 1.3 0 0 0 1.1 2h10a1.3 1.3 0 0 0 1.1-2L9.1 2.9a1.3 1.3 0 0 0-2.2 0Z" />
        <path d="M8 6.3v2.9" />
        <circle cx="8" cy="11.5" r=".8" fill="currentColor" stroke="none" />
      </>
    ),
    system: (
      <>
        <path d="M2.5 4.5h4M10.5 4.5h3M2.5 11.5h2M8.5 11.5h5" />
        <circle cx="8.5" cy="4.5" r="1.8" />
        <circle cx="6.5" cy="11.5" r="1.8" />
      </>
    ),
    state: (
      <>
        <circle cx="8" cy="8" r="5.6" />
        <circle cx="8" cy="8" r="1.9" fill="currentColor" stroke="none" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[kind]}
    </svg>
  );
}
export function TraceStatusBadge({ node }: { node: TraceNode }) {
  return (
    <span className={`trace-status trace-status-${node.status.toLowerCase()}`}>
      {node.status === "Running" ? <span className="trace-spinner" /> : null}
      {statusLabel(node.status)}
    </span>
  );
}

/** Paginated code keeps very large results fully accessible without a giant DOM/highlight pass. */
export function TraceCode({
  content,
  language = "text",
}: {
  content: string;
  language?: string;
}) {
  const [page, setPage] = useState(0),
    [tokens, setTokens] = useState<ThemedToken[][] | null>(null),
    [copied, setCopied] = useState(false);
  const segments = useMemo(() => traceCodePages(content), [content]);
  const pages = segments.length;
  const safePage = Math.min(page, pages - 1),
    part = segments[safePage]!.text;
  const lineCount = (content.match(/\n/g) ?? []).length + 1;
  useEffect(() => {
    let alive = true;
    setTokens(null);
    if (language !== "text" && part.length < 80000)
      void highlightSnippet(language, part).then((t) => {
        if (alive) setTokens(t);
      });
    return () => {
      alive = false;
    };
  }, [part, language]);
  useEffect(() => {
    setPage(0);
  }, [language]);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <div className="trace-code-wrap">
      <div className="trace-code-toolbar">
        <span>
          {language} · {lineCount.toLocaleString()} {tr("行", "lines")}
        </span>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard
              .writeText(content)
              .then(() => setCopied(true))
              .catch(() => setCopied(false));
          }}
        >
          {copied ? tr("已复制", "Copied") : tr("复制完整内容", "Copy all")}
        </button>
      </div>
      <pre className="trace-code">
        <code>
          {tokens
            ? tokens.map((line, i) => (
                <span className="trace-code-line" key={i}>
                  {line.map((t, j) => (
                    <span key={j} style={{ color: t.color }}>
                      {t.content}
                    </span>
                  ))}
                  {"\n"}
                </span>
              ))
            : part || tr("无内容", "No content")}
        </code>
      </pre>
      {pages > 1 ? (
        <div className="trace-code-pages">
          <button
            disabled={safePage === 0}
            onClick={() => setPage(safePage - 1)}
          >
            {tr("上一段", "Previous")}
          </button>
          <span>
            {safePage + 1} / {pages} · {segments[safePage]!.firstLine}–
            {segments[safePage]!.lastLine}
          </span>
          <button
            disabled={safePage === pages - 1}
            onClick={() => setPage(safePage + 1)}
          >
            {tr("下一段", "Next")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
function SchemaTree({
  value,
  name = "Schema",
  depth = 0,
}: {
  value: unknown;
  name?: string;
  depth?: number;
}) {
  if (value === null || typeof value !== "object")
    return (
      <div className="trace-schema-leaf">
        <span>{name}: </span>
        <code>{JSON.stringify(value)}</code>
      </div>
    );
  return (
    <details className="trace-schema-tree" open={depth === 0}>
      <summary>
        <span>{name}</span>
        <small>
          {Array.isArray(value)
            ? `[${value.length}]`
            : `{${Object.keys(value).length}}`}
        </small>
      </summary>
      <div>
        {Object.entries(value).map(([key, child]) => (
          <SchemaTree key={key} name={key} value={child} depth={depth + 1} />
        ))}
      </div>
    </details>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="trace-field">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="trace-detail-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}
function Timing({ details }: { details: TraceDetails }) {
  const { node, request } = details,
    tool = node.kind === "tool-call" || node.kind === "tool-result";
  return (
    <dl className="trace-fields">
      <Field label={tr("开始时间", "Start time")}>
        {timeLabel(
          tool
            ? (node.executionStartedAt ?? node.startedAt)
            : (request?.startedAt ?? node.startedAt),
        )}
      </Field>
      <Field label={tr("总时长", "Duration")}>
        {node.status === "Running"
          ? tr("执行中", "Running")
          : durationLabel(
              tool ? node.durationMs : (request?.durationMs ?? null),
            )}
      </Field>
      {!tool ? (
        <>
          <Field label={tr("首 Token 延迟", "Time to first token")}>
            {request?.firstTokenMs === null
              ? tr("未测得", "Not measured")
              : durationLabel(request?.firstTokenMs ?? null)}
          </Field>
          <Field label={tr("模型生成耗时", "Generation")}>
            {durationLabel(request?.generationMs ?? null)}
          </Field>
          <Field label={tr("吞吐量", "Throughput")}>
            {request?.usage && request.generationMs && request.generationMs > 0
              ? `${Math.round((request.usage.output / request.generationMs) * 1000)} tok/s`
              : "—"}
          </Field>
        </>
      ) : null}
      <Field label={tr("计时来源", "Timing source")}>
        {node.historical
          ? tr(
              "会话时间戳；精确耗时未记录",
              "Session timestamp; duration not recorded",
            )
          : tr("运行时单调时钟", "Runtime monotonic clock")}
      </Field>
    </dl>
  );
}
const tabNames: Record<string, [string, string]> = {
  overview: ["概述", "Overview"],
  preview: ["预览", "Preview"],
  raw: ["原始内容", "Raw"],
  source: ["来源", "Source"],
  arguments: ["参数", "Arguments"],
  result: ["结果", "Result"],
  schema: ["Schema", "Schema"],
  timing: ["计时", "Timing"],
  prompt: ["系统提示词", "System prompt"],
  tools: ["工具", "Tools"],
};
export function TraceInspector({
  conversationId,
  node,
  sourceNodeId,
  onClose,
}: {
  conversationId: string;
  node: TraceNode;
  sourceNodeId?: string;
  onClose: () => void;
}) {
  const [storedDetails, setDetails] = useState<TraceDetails | null>(null),
    [error, setError] = useState<string | null>(null),
    [tab, setTab] = useState(
      node.kind === "system"
        ? "prompt"
        : node.kind === "tool-result"
          ? "result"
          : "overview",
    );
  useEffect(() => {
    let alive = true;
    setError(null);
    if (!window.vela) {
      setError(tr("轨迹服务不可用", "Trace service unavailable"));
      return;
    }
    void window.vela
      .getTraceDetails(conversationId, sourceNodeId ?? node.id)
      .then((d) => {
        if (alive) {
          setDetails(d);
          if (!d) setError(tr("未找到节点详情", "Node details unavailable"));
        }
      })
      .catch((e) => {
        if (alive) setError(String(e));
      });
    return () => {
      alive = false;
    };
  }, [conversationId, node.id, node.version, sourceNodeId]);
  const details = storedDetails && sourceNodeId
    ? {
        ...storedDetails,
        node,
        content: stringify(storedDetails.responseBlocks),
        raw: storedDetails.responseBlocks,
      }
    : storedDetails;
  const system = node.kind === "system",
    tool = node.kind === "tool-call" || node.kind === "tool-result",
    model = node.kind === "thinking" || node.kind === "assistant";
  const tabs = sourceNodeId
    ? ["overview", "raw", "timing"]
    : system
    ? ["prompt", "tools"]
    : tool
      ? ["overview", "arguments", "result", "schema", "timing"]
      : node.kind === "user"
        ? ["overview", "preview", "raw", "source"]
        : ["overview", "preview", "raw"];
  const actualTab = tabs.includes(tab) ? tab : tabs[0]!;
  const tabIndicator = useSlidingTabIndicator({ activeKey: actualTab });
  const body = details?.content ?? "";
  const raw = details?.raw;
  const images =
    raw &&
    typeof raw === "object" &&
    "content" in raw &&
    Array.isArray(raw.content)
      ? raw.content.filter(
          (part): part is { type: "image"; data: string; mimeType: string } =>
            part?.type === "image" &&
            typeof part.data === "string" &&
            typeof part.mimeType === "string",
        )
      : [];
  return (
    <aside
      className="trace-inspector"
      aria-label={tr("节点详情", "Node inspector")}
    >
      <header className="trace-inspector-header">
        <span className={`trace-kind trace-kind-${node.kind}`}>
          <TraceIcon kind={node.kind} />
          {sourceNodeId ? tr("模型请求", "Model request") : kindLabel(node.kind)}
        </span>
        <span className="trace-inspector-location">
          {node.kind === "system"
            ? tr("Agent 上下文", "Agent context")
            : `${tr("第", "Turn")} ${node.turn} ${tr("轮", "")} · ${node.kind === "user" ? tr("消息", "Message") : `${tr("第", "Step")} ${node.step} ${tr("步", "")}`}`}
        </span>
        <button
          className="trace-icon-button"
          onClick={onClose}
          aria-label={tr("关闭详情", "Close inspector")}
          title={tr("关闭详情", "Close inspector")}
        >
          ×
        </button>
      </header>
      <nav
        ref={tabIndicator.navRef}
        className="trace-inspector-tabs"
        role="tablist"
        aria-label={tr("详情视图", "Detail view")}
        onPointerMove={tabIndicator.onPointerMove}
        onPointerLeave={tabIndicator.onPointerLeave}
      >
        {tabs.map((t) => (
          <button
            type="button"
            role="tab"
            data-tab-key={t}
            aria-selected={actualTab === t}
            key={t}
            ref={tabIndicator.registerTab(t)}
            onClick={() => setTab(t)}
          >
            {tr(...tabNames[t]!)}
          </button>
        ))}
        {tabIndicator.indicator}
      </nav>
      <div className="trace-inspector-scroll" role="tabpanel">
        {error ? (
          <p role="alert">{error}</p>
        ) : !details ? (
          <p className="trace-muted">
            {tr("正在读取详情…", "Loading details…")}
          </p>
        ) : (
          <>
            {actualTab === "prompt" ? (
              <TraceCode
                content={
                  details.context?.systemPrompt ??
                  tr("未记录系统提示词", "System prompt was not recorded")
                }
              />
            ) : null}
            {actualTab === "tools" ? (
              <div className="trace-tools">
                {details.context?.tools.length ? (
                  details.context.tools.map((t) => (
                    <details key={t.name}>
                      <summary>
                        <code>{t.name}</code>
                        <span>{t.description.split("\n")[0]}</span>
                      </summary>
                      <p className="trace-tool-description">{t.description}</p>
                      <SchemaTree value={t.parameters} />
                      <TraceCode content={stringify(t)} language="json" />
                    </details>
                  ))
                ) : (
                  <p className="trace-muted">
                    {tr("未记录工具定义", "Tool definitions were not recorded")}
                  </p>
                )}
              </div>
            ) : null}
            {actualTab === "overview" ? (
              <>
                <dl className="trace-fields">
                  <Field label={tr("来源", "Source")}>
                    {node.requestId
                      ? `${tr("请求", "Request")} #${details.request?.number ?? node.step}`
                      : kindLabel(node.kind)}
                  </Field>
                  {tool ? (
                    <>
                      <Field label={tr("工具名称", "Tool")}>
                        <code>{node.toolName}</code>
                      </Field>
                      {node.mcp ? (
                        <Field label={tr("MCP 服务", "MCP server")}>
                          <code><bdi>{node.mcp.server}</bdi></code>
                        </Field>
                      ) : null}
                      <Field label={tr("层级", "Parent")}>
                        {tr("助手消息", "Assistant message")}
                      </Field>
                    </>
                  ) : null}
                  <Field label={tr("状态", "Status")}>
                    <TraceStatusBadge node={node} />
                  </Field>
                  {model ? (
                    <>
                      <Field label={tr("模型", "Model")}>
                        {details.request?.model ?? "—"}
                      </Field>
                      <Field label={tr("Token（请求级）", "Tokens (request)")}>
                        {details.request?.usage?.totalTokens?.toLocaleString() ??
                          "—"}{" "}
                        tok
                      </Field>
                      <Field label={tr("输出 Token", "Output tokens")}>
                        {details.request?.usage?.output?.toLocaleString() ??
                          "—"}{" "}
                        tok
                      </Field>
                    </>
                  ) : null}
                  {node.kind === "user" ? (
                    <Field label={tr("时长", "Duration")}>
                      {durationLabel(node.durationMs)}
                    </Field>
                  ) : null}
                </dl>
                {tool ? (
                  <>
                    <Section title={tr("参数", "Arguments")}>
                      <TraceCode
                        content={
                          details.arguments === null
                            ? body
                            : stringify(details.arguments)
                        }
                        language={details.arguments === null ? "text" : "json"}
                      />
                    </Section>
                    <Section title={tr("返回结果", "Result")}>
                      <TraceCode
                        content={
                          details.result === null
                            ? tr("尚无返回结果", "No result yet")
                            : resultText(details.result)
                        }
                      />
                    </Section>
                  </>
                ) : (
                  <Section
                    title={
                      node.kind === "thinking"
                        ? tr("思考", "Thinking")
                        : tr("内容", "Content")
                    }
                  >
                    <TraceCode content={body || tr("未提供", "Not provided")} />
                  </Section>
                )}
                {model ? (
                  <Section title={tr("请求计时", "Request timing")}>
                    <Timing details={details} />
                  </Section>
                ) : null}
              </>
            ) : null}
            {actualTab === "preview" ? (
              <div className="trace-preview">
                {node.kind === "assistant" || node.kind === "user" ? (
                  <>
                    <Markdown text={body} />
                    <div className="trace-user-images">
                      {images.map((image, index) => (
                        <img
                          key={index}
                          alt={trf("用户附件 {0}", "User attachment {0}", index + 1)}
                          src={`data:${image.mimeType};base64,${image.data}`}
                        />
                      ))}
                    </div>
                  </>
                ) : (
                  <TraceCode content={body} />
                )}
              </div>
            ) : null}
            {actualTab === "raw" ? (
              <TraceCode
                content={
                  model
                    ? details.responseBlocks
                        .map((b, i) => {
                          const block = (b ?? {}) as {
                            type?: string;
                            thinking?: string;
                            text?: string;
                            arguments?: unknown;
                          };
                          return `${tr("块", "Block")} #${i + 1} ${block.type}\n\n${block.type === "toolCall" ? stringify(block.arguments) : (block.thinking ?? block.text ?? stringify(block))}`;
                        })
                        .join("\n\n")
                    : stringify(details.raw)
                }
                language={model ? "text" : "json"}
              />
            ) : null}
            {actualTab === "source" ? (
              <TraceCode content={stringify(details.source)} language="json" />
            ) : null}
            {actualTab === "arguments" ? (
              <TraceCode
                content={
                  details.arguments === null
                    ? body
                    : stringify(details.arguments)
                }
                language={details.arguments === null ? "text" : "json"}
              />
            ) : null}
            {actualTab === "result" ? (
              <>
                <TraceCode
                  content={
                    details.result === null
                      ? tr("尚无返回结果", "No result yet")
                      : resultText(details.result)
                  }
                />
                {details.result !== null ? (
                  <details className="trace-raw-result">
                    <summary>{tr("原始返回对象", "Raw result object")}</summary>
                    <TraceCode
                      content={stringify(details.result)}
                      language="json"
                    />
                  </details>
                ) : null}
              </>
            ) : null}
            {actualTab === "schema" ? (
              <>
                {details.context?.tools.find(
                  (t) => t.name === node.toolName,
                ) ? (
                  (() => {
                    const definition = details.context!.tools.find(
                      (t) => t.name === node.toolName,
                    )!;
                    return (
                      <>
                        <Section title={definition.name}>
                          <p className="trace-tool-description">
                            {definition.description}
                          </p>
                          <SchemaTree value={definition.parameters} />
                        </Section>
                        <TraceCode
                          content={stringify(definition)}
                          language="json"
                        />
                      </>
                    );
                  })()
                ) : (
                  <p className="trace-muted">
                    {tr(
                      "该次请求未记录此工具定义",
                      "This request did not record this tool definition",
                    )}
                  </p>
                )}
              </>
            ) : null}
            {actualTab === "timing" ? (
              <>
                <Timing details={details} />
                {tool ? (
                  <dl className="trace-fields">
                    <Field label={tr("调用产生时间", "Call emitted")}>
                      {timeLabel(node.startedAt)}
                    </Field>
                  </dl>
                ) : null}
              </>
            ) : null}
          </>
        )}
      </div>
    </aside>
  );
}
