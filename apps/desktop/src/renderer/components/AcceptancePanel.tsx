import { useId, useState } from "react";
import type { OutcomeChange, OutcomeConfirm, OutcomeEvidence, OutcomeItem } from "@vela/shared";
import { tr, trf } from "../locale";
import type { AcceptanceRequest } from "./acceptance";
import { BashView } from "./ToolCard";
import { FileTypeIcon } from "./FileTypeIcon";
import { ArrowRightIcon, CheckIcon, CircleIcon, TerminalIcon } from "./icons";

function confirmationText(confirm: OutcomeConfirm): string {
  // agent 自己写的内容原样保留，系统生成的提示才参与本地化。
  if (confirm.kind === "agent") return confirm.text === "需求尚未完成" ? tr("需求尚未完成", "This requirement is not complete") : confirm.text;
  const filePrefix = "未找到本轮修改：";
  const evidencePrefix = "未找到本轮已完成的验证：";
  if (confirm.text.startsWith(filePrefix)) return trf("未找到本轮修改：{0}", "No change in this turn matches: {0}", confirm.text.slice(filePrefix.length));
  if (confirm.text.startsWith(evidencePrefix)) return trf("未找到本轮已完成的验证：{0}", "No completed verification in this turn matches: {0}", confirm.text.slice(evidencePrefix.length));
  switch (confirm.kind) {
    case "no-evidence": return tr("此需求没有验证证据", "This requirement has no verification evidence");
    case "stale": return tr("验证之后文件又被修改，结果可能已过期", "Files changed after verification; the result may be stale");
    case "failed": return tr("此需求有失败的验证", "This requirement has failed verification");
    case "no-diff": return tr("部分修改没有可审查的工具 diff", "Some changes have no saved tool diff to review");
    case "unattributed": return tr("本轮还有未归属到需求的修改或验证", "Some changes or verifications in this turn are not attributed to a requirement");
  }
}

function Status({ status }: { status: OutcomeItem["status"] }) {
  return <span className={`acceptance-status is-${status}`}>
    {status === "done" ? <CheckIcon size={12} /> : <CircleIcon size={12} />}
    {status === "done" ? tr("已完成", "Done") : status === "partial" ? tr("部分完成", "Partial") : tr("未完成", "Not done")}
  </span>;
}

function EvidenceRow({ evidence, request }: { evidence: OutcomeEvidence; request: AcceptanceRequest }) {
  const [open, setOpen] = useState(evidence.result === "failed");
  const id = useId();
  const tool = request.tools.find(item => item.id === evidence.toolCallId && item.name === "bash" && item.status !== "running");
  const result = evidence.result === "passed" ? tr("通过", "Passed") : evidence.result === "failed" ? tr("失败", "Failed") : tr("结果未知", "Unknown result");
  return <div className={`acceptance-evidence is-${evidence.result}`}>
    <button type="button" className="acceptance-evidence-toggle" aria-expanded={open} aria-controls={id}
      onClick={() => setOpen(value => !value)}>
      <TerminalIcon size={14} /><code>{evidence.command}</code>
      <span className={`acceptance-result is-${evidence.result}`}>{result}</span>
      {evidence.stale ? <span className="acceptance-stale">{tr("已过期", "Stale")}</span> : null}
      <ArrowRightIcon size={12} />
    </button>
    <div id={id} className="acceptance-evidence-output" hidden={!open}>
      {evidence.exitCode !== undefined ? <div className="acceptance-output-meta">{trf("退出码 {0}", "Exit code {0}", evidence.exitCode)}</div> : null}
      {!tool ? <p className="acceptance-empty">{tr("完整输出未保存，仅显示记录摘要", "Full output was not saved; showing the recorded excerpt")}</p> : null}
      <BashView command={evidence.command} output={tool?.activity.body ?? evidence.outputTail} running={false} failed={evidence.result === "failed"} />
    </div>
  </div>;
}

/** 从保存的本轮记录读取事实，不访问当前磁盘或再次执行验证。 */
export function AcceptancePanel({ request, onOpenDiff }: {
  request: AcceptanceRequest;
  onOpenDiff: (path: string, diffToolId?: string) => void;
}) {
  const [selected, setSelected] = useState(0);
  const id = useId();
  const { outcome } = request;
  const item = outcome.items[selected] ?? outcome.items[0];
  const hasUnattributed = outcome.unattributed.files.length > 0 || outcome.unattributed.verifications.length > 0;
  const renderChange = (change: OutcomeChange) => <li key={change.path} className="acceptance-change">
    <button type="button" className="acceptance-change-link" disabled={!change.diffToolIds.length}
      title={change.path} onClick={() => onOpenDiff(change.path, change.diffToolIds[0])}>
      <FileTypeIcon path={change.path} /><span className="acceptance-change-path">{change.path}</span>
      {change.origin === "tool" ? <span className="acceptance-change-stats"><span className="turn-changes-added">+{change.added}</span><span className="turn-changes-removed">−{change.removed}</span></span> : null}
      {change.diffToolIds.length ? <ArrowRightIcon size={12} /> : null}
    </button>
    {!change.diffToolIds.length ? <p className="acceptance-change-note">{tr("没有保存的 diff", "No saved diff")}</p> : null}
    {change.diffToolIds.length > 1 ? <div className="acceptance-edits">{change.diffToolIds.map((toolId, index) => <button type="button" key={toolId}
      onClick={() => onOpenDiff(change.path, toolId)}>{trf("编辑 {0} / {1}", "Edit {0} / {1}", index + 1, change.diffToolIds.length)}</button>)}</div> : null}
  </li>;

  return <div className="acceptance-panel" role="region" aria-labelledby={`${id}-title`}>
    <header className="acceptance-toolbar"><CheckIcon size={14} /><strong id={`${id}-title`}>{tr("成果验收", "Outcome acceptance")}</strong>
      <span>{trf("{0} 项需求", "{0} requirements", outcome.items.length)}</span></header>
    {outcome.source === "derived" ? <p className="acceptance-derived">{tr("未提交需求归属，按本轮记录汇总", "No requirement attribution was submitted; summarized from this turn’s records")}</p> : null}
    <div className="acceptance-body">
      <nav className="acceptance-requirements" aria-label={tr("需求", "Requirements")}>
        {outcome.items.map((requirement, index) => <button type="button" key={index} className={`acceptance-requirement${selected === index ? " is-selected" : ""}`}
          aria-current={selected === index ? "true" : undefined} aria-controls={`${id}-detail`} onClick={() => setSelected(index)}>
          <span className="acceptance-requirement-text">{requirement.requirement === "本轮任务" && outcome.source === "derived" ? tr("本轮任务", "This turn’s task") : requirement.requirement}</span>
          <Status status={requirement.status} />
        </button>)}
      </nav>
      <div id={`${id}-detail`} className="acceptance-detail" key={`${request.turnId}:${selected}`}>
        {item ? <>
          <header className="acceptance-detail-heading"><h2>{item.requirement === "本轮任务" && outcome.source === "derived" ? tr("本轮任务", "This turn’s task") : item.requirement}</h2>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
              <Status status={item.status} />
              {item.evidence.some(evidence => evidence.result === "failed") ? <span className="acceptance-result is-failed">{tr("验证失败", "Verification failed")}</span> : null}
              {item.evidence.some(evidence => evidence.stale) ? <span className="acceptance-stale">{tr("证据已过期", "Evidence is stale")}</span> : null}
            </div>
          </header>
          <section className="acceptance-section"><h3>{tr("修改", "Changes")}</h3>
            {item.changes.length ? <ul className="acceptance-change-list">{item.changes.map(renderChange)}</ul> : <p className="acceptance-empty">{tr("此需求没有记录到文件修改", "No file changes were recorded for this requirement")}</p>}
          </section>
          <section className="acceptance-section"><h3>{tr("验证证据", "Verification evidence")}</h3>
            {item.evidence.length ? item.evidence.map(evidence => <EvidenceRow key={evidence.toolCallId} request={request} evidence={evidence} />) : <p className="acceptance-empty">{tr("此需求没有验证证据", "This requirement has no verification evidence")}</p>}
          </section>
          <section className="acceptance-section"><h3>{tr("待确认", "To confirm")}</h3>
            {item.toConfirm.length ? <ul className="acceptance-confirmations">{item.toConfirm.map((confirm, index) => <li key={index} data-kind={confirm.kind}>{confirmationText(confirm)}</li>)}</ul> : <p className="acceptance-empty">{tr("没有待确认事项", "Nothing to confirm")}</p>}
          </section>
        </> : <p className="acceptance-empty">{tr("没有可验收的需求", "No requirements to review")}</p>}
        {hasUnattributed ? <section className="acceptance-section acceptance-unattributed"><h3>{tr("未归属的记录", "Unattributed records")}</h3>
          <ul className="acceptance-change-list">{outcome.unattributed.files.map(renderChange)}</ul>
          {outcome.unattributed.verifications.map(evidence => <EvidenceRow key={evidence.toolCallId} request={request} evidence={evidence} />)}
        </section> : null}
      </div>
    </div>
  </div>;
}
