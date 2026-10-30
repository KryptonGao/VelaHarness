import type { JsonValue, ToolActivity, ToolPresentation, ToolTrace } from "@vela/shared";
import { useEffect, useState, type ReactNode } from "react";
import { activeIntlLocale, localizeError, tr, trf, useAppLocale } from "../locale";
import { Markdown } from "./Markdown";
import { StructuredValue } from "./StructuredValue";
import { resultHttpUrl, resultPageSize, resultRecord, resultText, resultTimestamp, processFailed } from "./tool-result-model";
import { isScheduledStatus, isTaskSchedule, scheduledScheduleText, scheduledStatusText } from "./scheduled-task-format";
import "./tool-result-details.css";

type Presentation<K extends ToolPresentation["kind"]> = Extract<ToolPresentation, { kind: K }>;

function Fields({ fields }: { fields: Array<[string, ReactNode]> }) {
  return <dl className="tool-result-fields">{fields.filter(([, value]) => value !== undefined && value !== null && value !== "").map(([label, value]) =>
    <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

function PagedList<T>({ items, render, empty }: { items: readonly T[]; render: (item: T, index: number) => ReactNode; empty?: string }) {
  const [visible, setVisible] = useState(resultPageSize);
  if (!items.length) return <p className="tool-result-muted">{empty ?? tr("暂无结果", "No results")}</p>;
  return <><div className="tool-result-list">{items.slice(0, visible).map((item, index) => <div className="tool-result-list-item" key={index}>{render(item, index)}</div>)}</div>
    {items.length > visible ? <button type="button" className="tool-result-more" onClick={() => setVisible(current => current + resultPageSize)}>
      {trf("继续显示（剩余 {0} 项）", "Show more ({0} remaining)", items.length - visible)}
    </button> : null}</>;
}

function RawResponse({ body, fallback }: { body?: string; fallback: ToolPresentation }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const text = body ?? JSON.stringify(fallback, null, 2);
  useEffect(() => { setCopyState("idle"); }, [text]);
  useEffect(() => {
    if (copyState === "idle") return;
    const timeout = window.setTimeout(() => setCopyState("idle"), 1800);
    return () => window.clearTimeout(timeout);
  }, [copyState]);
  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopyState("copied"); }
    catch { setCopyState("failed"); }
  }
  return <details className="tool-result-aux tool-result-raw"><summary>{body === undefined ? tr("记录数据", "Recorded data") : tr("原始响应", "Raw response")}</summary>
    {body === undefined ? <p className="tool-result-muted">{tr("此记录未包含原始文本响应。", "This record does not include the original text response.")}</p> : null}
    <div className="tool-result-copy-row"><button type="button" className="tool-result-more" onClick={() => { void copy(); }}>{tr("复制", "Copy")}</button>
      <span className="tool-result-muted" role="status">{copyState === "copied" ? tr("已复制", "Copied") : copyState === "failed" ? tr("复制失败，请选择文本复制", "Copy failed. Select the text to copy.") : ""}</span></div>
    <pre className="tool-result-raw-text" tabIndex={0}>{text}</pre>
  </details>;
}

function Status({ value }: { value: string | undefined }) {
  const labels: Record<string, [string, string]> = {
    running: ["运行中", "Running"], exited: ["已退出", "Exited"], timed_out: ["已超时", "Timed out"],
    killed: ["已终止", "Stopped"], stopped: ["已终止", "Stopped"], failed: ["失败", "Failed"],
    cancelled: ["已取消", "Cancelled"], active: ["进行中", "Active"], complete: ["完成", "Complete"],
    paused: ["已暂停", "Paused"], passed: ["通过", "Passed"], known_issues: ["存在已知问题", "Known issues"],
    skipped: ["已跳过", "Skipped"], saved: ["已保存", "Saved"], cleared: ["已清空", "Cleared"], unchanged: ["内容未变化", "Unchanged"], read: ["读取完成", "Read completed"], update: ["更新记忆", "Update memory"],
  };
  return <>{value ? labels[value] ? tr(...labels[value]) : value : tr("未知", "Unknown")}</>;
}

function ShellResult({ value, status }: { value: Presentation<"shell">; status: ToolTrace["status"] }) {
  const { shell } = value;
  const failed = processFailed(shell.status, shell.exitCode);
  const requested = value.source === "request";
  return <div className={`tool-shell-result${failed ? " is-process-failed" : ""}`}>
    <div className="tool-result-heading">{status === "running" ? tr("正在执行", "Running…") : status === "error" ? tr("调用失败", "Call failed") : value.operation === "read" ? tr("读取完成", "Read completed") : tr("工具调用完成", "Tool call completed")}</div>
    <Fields fields={[
      [tr("后台命令", "Background command"), shell.command ? <code>{shell.command}</code> : undefined],
      [tr("Shell 标识", "Shell ID"), shell.id],
      [tr("进程状态", "Process status"), requested ? tr("等待执行结果", "Waiting for execution result") : <span className={failed ? "tool-result-error" : undefined}><Status value={shell.status} /></span>],
      [tr("退出码", "Exit code"), shell.exitCode === null || shell.exitCode === undefined ? undefined : <span className={failed ? "tool-result-error" : undefined}>{shell.exitCode}</span>],
    ]} />
    {value.operation === "kill" && value.killed !== undefined ? <p>{value.killed ? tr("已停止后台命令", "Background command stopped") : tr("后台命令此前已退出", "The background command had already exited")}</p> : null}
    {value.output ? <div className={`tool-terminal${failed ? " failed" : ""}`}><pre className="tool-terminal-out">{value.output}</pre></div>
      : value.operation === "read" && !requested && status !== "running" && status !== "error" ? <p className="tool-result-muted">{tr("暂无新增输出", "No new output")}</p> : null}
    <details className="tool-result-aux"><summary>{tr("进程信息", "Process details")}</summary><Fields fields={[
      [tr("工作目录", "Working directory"), shell.cwd],
      [tr("开始时间", "Started"), shell.startedAt === undefined ? undefined : resultTimestamp(shell.startedAt, activeIntlLocale())],
      [tr("结束时间", "Finished"), shell.endedAt == null ? undefined : resultTimestamp(shell.endedAt, activeIntlLocale())],
    ]} /></details>
  </div>;
}

function MemoryResult({ value }: { value: Presentation<"memory"> }) {
  return <><div className="tool-result-heading">{value.operation === "read" ? tr("记忆内容", "Memory content") : <Status value={value.operation} />}</div>
    <PagedList items={value.entries} render={entry => <section>
      <h4 className="tool-result-item-title">{entry.scope === "global" ? tr("全局记忆", "Global memory") : entry.scope === "project" ? tr("项目记忆", "Project memory") : entry.scope === "all" ? tr("全部", "All") : entry.scope}</h4>
      {entry.error ? <p className="tool-result-error" role="alert">{localizeError(entry.error)}</p> : null}
      {entry.exists === false ? <p className="tool-result-muted">{tr("记忆文件不存在", "Memory file does not exist")}</p> : null}
      {entry.content !== undefined ? entry.content === "" ? <p className="tool-result-muted">{tr("记忆内容为空", "Memory is empty")}</p> : <div className="tool-markdown tool-note"><Markdown text={entry.content} /></div> : null}
      <details className="tool-result-aux"><summary>{tr("来源信息", "Source information")}</summary><Fields fields={[
        [tr("路径", "Path"), entry.path], [tr("版本", "Revision"), entry.revision],
        [tr("字节数", "Bytes"), entry.bytes], [tr("状态", "Status"), entry.status ? <Status value={entry.status} /> : undefined],
      ]} /></details>
    </section>} /></>;
}

function TaskResult({ task }: { task: JsonValue }) {
  if (!resultRecord(task)) return <StructuredValue value={task} />;
  return <section>
    <h4 className="tool-result-item-title">{resultText(task.title) ?? resultText(task.id) ?? tr("定时任务", "Scheduled task")}</h4>
    <Fields fields={[
      [tr("状态", "Status"), isScheduledStatus(task.status) ? scheduledStatusText(task.status) : resultText(task.status)],
      [tr("周期", "Schedule"), isTaskSchedule(task.schedule) ? scheduledScheduleText(task.schedule) : undefined],
      [tr("下次执行", "Next run"), task.nextRunAt === undefined ? undefined : resultTimestamp(task.nextRunAt, activeIntlLocale())],
      [tr("工作区", "Workspace"), resultText(task.workspace)],
    ]} />
    <details className="tool-result-aux"><summary>{tr("任务详情", "Task details")}</summary><StructuredValue value={task} /></details>
  </section>;
}

function ScheduleResult({ value }: { value: Presentation<"schedule"> }) {
  if (value.operation === "delete") return <><div className="tool-result-heading">{value.source === "request" ? tr("等待执行结果", "Waiting for execution result") : tr("任务已删除", "Task deleted")}</div><Fields fields={[[tr("任务标识", "Task ID"), value.deletedId]]} /></>;
  return <>
    <div className="tool-result-heading">{trf("定时任务 · {0} 项", "Scheduled tasks · {0}", value.tasks.length)}</div>
    <PagedList items={value.tasks} empty={value.source === "request" ? tr("等待执行结果", "Waiting for execution result") : tr("暂无定时任务", "No scheduled tasks yet")} render={task => <TaskResult task={task} />} />
    {value.runs.length ? <details className="tool-result-aux"><summary>{trf("执行记录 · {0} 项", "Run history · {0}", value.runs.length)}</summary>
      <PagedList items={value.runs} render={run => resultRecord(run) ? <>
        <Fields fields={[
          [tr("状态", "Status"), isScheduledStatus(run.status) ? scheduledStatusText(run.status) : resultText(run.status)],
          [tr("开始时间", "Started"), resultTimestamp(run.startedAt, activeIntlLocale())],
          [tr("结束时间", "Finished"), run.finishedAt === null ? undefined : resultTimestamp(run.finishedAt, activeIntlLocale())],
          [tr("任务标识", "Task ID"), resultText(run.taskId)],
        ]} />
        {typeof run.error === "string" ? <p className="tool-result-error">{localizeError(run.error)}</p> : null}
        <details className="tool-result-aux"><summary>{tr("记录详情", "Record details")}</summary><StructuredValue value={run} /></details>
      </> : <StructuredValue value={run} />} />
    </details> : null}
  </>;
}

function DiscoveryResult({ value }: { value: Presentation<"discovery"> }) {
  return <><Fields fields={[[tr("查询", "Query"), value.query], [tr("加载工具数", "Loaded tools"), value.source === "request" ? undefined : value.tools.length]]} />
    <PagedList items={value.tools} empty={value.source === "request" ? tr("等待执行结果", "Waiting for execution result") : tr("未找到匹配工具", "No matching tools found")}  render={tool => <><h4 className="tool-result-item-title"><code>{tool.name}</code></h4>{tool.description ? <p>{tool.description}</p> : null}</>} />
  </>;
}

function ResourceContent({ value }: { value: JsonValue }) {
  if (!resultRecord(value)) return <StructuredValue value={value} />;
  if (typeof value.text === "string") return <section>
    {typeof value.uri === "string" ? <p className="tool-result-muted">{value.uri}</p> : null}
    {value.mimeType === "text/markdown" ? <div className="tool-markdown tool-note"><Markdown text={value.text} /></div> : <pre className="tool-result-content-text">{value.text}</pre>}
    <details className="tool-result-aux"><summary>{tr("内容详情", "Content details")}</summary><StructuredValue value={value} /></details>
  </section>;
  return <StructuredValue value={value} />;
}

function ResourceResult({ value }: { value: Presentation<"resource"> }) {
  if (value.source === "request") return <Fields fields={[[tr("MCP 服务器", "MCP server"), value.server], ["URI", value.uri]]} />;
  const record = resultRecord(value.value) ? value.value : undefined;
  const list = record?.resources ?? record?.resourceTemplates;
  const contents = record?.contents;
  return <><Fields fields={[[tr("MCP 服务器", "MCP server"), value.server], ["URI", value.uri]]} />
    {value.operation === "read" && Array.isArray(contents) ? <PagedList items={contents} render={content => <ResourceContent value={content} />} />
      : value.operation === "read" && typeof value.value === "string" ? <pre className="tool-result-content-text">{value.value}</pre>
      : Array.isArray(list) ? <PagedList items={list} render={resource => {
        if (!resultRecord(resource)) return <StructuredValue value={resource} />;
        const title = resultText(resource.title) ?? resultText(resource.name) ?? resultText(resource.uri) ?? resultText(resource.uriTemplate);
        const url = resultHttpUrl(resource.uri);
        return <section><h4 className="tool-result-item-title">{url ? <a href={url} target="_blank" rel="noreferrer noopener">{title}</a> : title}</h4>
          <Fields fields={[["URI", resultText(resource.uri) ?? resultText(resource.uriTemplate)], [tr("类型", "Type"), resultText(resource.mimeType)], [tr("MCP 服务器", "MCP server"), resultText(resource.server)]]} />
          {typeof resource.description === "string" ? <p>{resource.description}</p> : null}
          <details className="tool-result-aux"><summary>{tr("资源详情", "Resource details")}</summary><StructuredValue value={resource} /></details>
        </section>;
      }} /> : <StructuredValue value={value.value} />}
    {Array.isArray(record?.errors) ? <div className="tool-result-error"><StructuredValue value={record.errors} /></div> : null}
    {record?.nextCursor ? <p className="tool-result-muted">{tr("还有后续资源；此处仅展示本次返回结果。", "More resources are available; only this response is shown.")}</p> : null}
    {(value.images ?? []).map((image, index) => /^(image\/(png|jpeg|webp|gif))$/.test(image.mimeType) && /^[A-Za-z0-9+/]*={0,2}$/.test(image.data) && image.data.length <= 2_796_204 ? <img className="tool-result-image" key={index} src={`data:${image.mimeType};base64,${image.data}`} alt={trf("资源图片 {0}", "Resource image {0}", index + 1)} /> : null)}
    {value.fullOutputPath ? <p className="tool-result-muted">{tr("完整输出路径", "Full output path")}: <code>{value.fullOutputPath}</code></p> : null}
    {record ? <details className="tool-result-aux"><summary>{tr("响应元数据", "Response metadata")}</summary><StructuredValue value={value.value} /></details> : null}
  </>;
}

function CheckCategory({ value }: { value: string | undefined }) {
  switch (value) {
    case "diff": return <>{tr("差异检查", "Diff check")}</>;
    case "test": return <>{tr("测试", "Tests")}</>;
    case "build": return <>{tr("构建", "Build")}</>;
    case "typecheck": return <>{tr("类型检查", "Typecheck")}</>;
    case "regression": return <>{tr("回归检查", "Regression check")}</>;
    case "other": return <>{tr("其他检查", "Other check")}</>;
    default: return <>{value}</>;
  }
}

function GoalResult({ value }: { value: Presentation<"goal"> }) {
  const goal = resultRecord(value.goal) ? value.goal : undefined;
  const validation = resultRecord(value.validation) ? value.validation : undefined;
  return <>
    {goal ? <Fields fields={[
      [tr("目标", "Goal"), resultText(goal.objective)], [tr("状态", "Status"), <Status value={resultText(goal.status)} />], [tr("说明", "Note"), resultText(goal.note)],
    ]} /> : null}
    {validation ? <>
      <Fields fields={[
        [tr("风险", "Risk"), validation.risk === "high" ? tr("高风险", "High risk") : validation.risk === "medium" ? tr("中风险", "Medium risk") : validation.risk === "low" ? tr("低风险", "Low risk") : resultText(validation.risk)],
        [tr("验证状态", "Validation status"), <Status value={resultText(validation.status)} />],
        [tr("验证时间", "Checked"), resultTimestamp(validation.checkedAt, activeIntlLocale())],
      ]} />
      {Array.isArray(validation.checks) ? <PagedList items={validation.checks} render={check => resultRecord(check) ? <section>
        <h4 className="tool-result-item-title"><CheckCategory value={resultText(check.category)} /> · <Status value={resultText(check.result)} /></h4>
        {typeof check.command === "string" ? <code>{check.command}</code> : null}
        {typeof check.output === "string" ? <details className="tool-result-aux"><summary>{tr("检查输出", "Check output")}</summary><pre className="tool-result-raw-text">{check.output}</pre></details> : null}
        <details className="tool-result-aux"><summary>{tr("记录详情", "Record details")}</summary><StructuredValue value={check} /></details>
      </section> : <StructuredValue value={check} />} /> : null}
      {Array.isArray(validation.skipped) && validation.skipped.length ? <details className="tool-result-aux"><summary>{tr("跳过的检查", "Skipped checks")}</summary><StructuredValue value={validation.skipped} /></details> : null}
      {Array.isArray(validation.knownIssues) && validation.knownIssues.length ? <details className="tool-result-aux"><summary>{tr("已知问题", "Known issues")}</summary><StructuredValue value={validation.knownIssues} /></details> : null}
      <details className="tool-result-aux"><summary>{tr("验证详情", "Validation details")}</summary><StructuredValue value={value.validation!} /></details>
    </> : null}
    {!goal && !validation ? <p className="tool-result-muted">{tr("此记录没有执行时的目标快照。", "This record has no goal snapshot from execution time.")}</p> : null}
    {value.requested !== undefined ? <details className="tool-result-aux"><summary>{tr("提交内容", "Submitted data")}</summary><StructuredValue value={value.requested} /></details> : null}
    {goal ? <details className="tool-result-aux"><summary>{tr("目标详情", "Goal details")}</summary><StructuredValue value={value.goal!} /></details> : null}
  </>;
}

export function ToolResultDetails({ activity, status, toolName }: { activity: ToolActivity; status: ToolTrace["status"]; toolName?: string }) {
  useAppLocale();
  const value = activity.presentation;
  if (!value) return null;
  let content: ReactNode;
  switch (value.kind) {
    case "shell": content = <ShellResult value={value} status={status} />; break;
    case "memory": content = <MemoryResult value={value} />; break;
    case "schedule": content = <ScheduleResult value={value} />; break;
    case "discovery": content = <DiscoveryResult value={value} />; break;
    case "resource": content = <ResourceResult value={value} />; break;
    case "goal": content = <GoalResult value={value} />; break;
    case "json": content = <StructuredValue value={value.value} />; break;
    case "notice": content = <p>{tr("执行上下文已重置，页面与登录状态保留。", "Execution context reset; pages and login state retained.")}</p>; break;
  }
  return <section className={`tool-result-details tool-result-${value.kind}`} aria-label={tr("工具结果", "Tool results")}>
    {status === "error" ? <p className="tool-result-error" role="alert">{activity.body ? localizeError(activity.body) : tr("调用失败", "Call failed")}</p> : null}
    {value.source === "request" ? <p className="tool-result-muted">{tr("以下为调用请求，不代表执行成功。", "This is the call request, not confirmation of success.")}</p> : null}
    {value.source === "legacy" ? <p className="tool-result-muted">{tr("根据旧格式记录整理", "Formatted from a legacy record")}</p> : null}
    {content}
    {value.truncated ? <p className="tool-result-muted" role="status">{tr("结果过长，部分内容已省略。", "The result is too large; some content was omitted.")}</p> : null}
    <details className="tool-result-aux tool-result-call"><summary>{tr("调用信息", "Call info")}</summary><Fields fields={[
      [tr("工具", "Tool"), toolName], [tr("状态", "Status"), status === "running" ? tr("正在执行", "Running…") : status === "error" ? tr("调用失败", "Call failed") : tr("工具调用完成", "Tool call completed")],
      [tr("命令", "Command"), activity.command], [tr("路径", "Path"), activity.path],
    ]} /></details>
    <RawResponse body={activity.body} fallback={value} />
  </section>;
}
