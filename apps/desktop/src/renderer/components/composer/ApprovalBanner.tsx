import type { SandboxApprovalRequest } from "@vela/shared";
import { useId, useState } from "react";
import { ShieldIcon } from "../icons";
import { useAttentionFocus } from "../attention-focus";
import { tr, trf } from "../../locale";

const kindLabels: Record<SandboxApprovalRequest["kind"], [string, string]> = {
  mcp: ["调用 MCP 工具", "Call MCP tool"],
  browser_repl: ["运行 JavaScript", "Run JavaScript"],
  bash: ["运行命令", "Run command"],
  edit: ["修改文件", "Edit file"],
  write: ["写入文件", "Write file"],
  mkdir: ["创建目录", "Create directory"],
  delegate: ["创建后台任务", "Create background task"],
  web: ["抓取网页", "Fetch web page"],
};

/**
 * 「每次询问」模式下的审批条,出现在输入框顶部:
 * Agent 请求越界操作时等待用户允许或拒绝。
 */
export function ApprovalSlot({
  approval,
  onReply,
}: {
  approval: SandboxApprovalRequest | null;
  onReply: (id: string, allowed: boolean) => void;
}) {
  const [shown, setShown] = useState(approval);
  if (approval && shown?.id !== approval.id) setShown(approval);
  // 默认落在「拒绝」上：误按 Enter 的代价是 Agent 多问一次，而不是放行越界操作。
  const slot = useAttentionFocus<HTMLDivElement>(Boolean(approval), ".approval-btn.deny");

  return (
    <div className={`approval-slot${approval ? " open" : ""}`} ref={slot}>
      <div className="approval-slot-inner" inert={approval ? undefined : true}>
        {shown ? <ApprovalBanner approval={shown} onReply={onReply} /> : null}
      </div>
    </div>
  );
}

export function ApprovalBanner({
  approval,
  onReply,
}: {
  approval: SandboxApprovalRequest;
  onReply: (id: string, allowed: boolean) => void;
}) {
  const summary = approval.kind === "mcp"
    ? [
        `${tr("服务器", "Server")}: ${approval.mcp?.server ?? tr("(未知)", "(Unknown)")}`,
        `${tr("工具", "Tool")}: ${approval.mcp?.tool ?? tr("(未知)", "(Unknown)")}`,
        `${tr("参数", "Parameters")}: ${JSON.stringify(approval.mcp?.parameters ?? null, null, 2)}`,
      ].join("\n")
    : approval.kind === "delegate"
      ? `${tr("工作区", "Workspace")}: ${approval.cwd ?? tr("(未知)", "(Unknown)")}\n${tr("任务", "Task")}: ${approval.command ?? tr("(未提供内容)", "(No content provided)")}`
    : (approval.kind === "bash" || approval.kind === "browser_repl" || approval.kind === "web")
      ? approval.command ?? tr("(未提供命令)", "(No command provided)")
      : approval.path ?? tr("(未提供路径)", "(No path provided)");
  const [kindZh, kindEn] = kindLabels[approval.kind];
  const titleId = useId();
  const summaryId = useId();

  return (
    <div
      className="approval-banner"
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={summaryId}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
        event.preventDefault();
        onReply(approval.id, false);
      }}
    >
      <div className="approval-banner-head">
        <span className="approval-banner-icon" aria-hidden="true">
          <ShieldIcon size={13} />
        </span>
        <span className="approval-banner-title" id={titleId}>{trf("{0}需要批准", "{0} requires approval", tr(kindZh, kindEn))}</span>
        <span className="approval-banner-hint" aria-hidden="true">{tr("Esc 拒绝", "Esc to deny")}</span>
      </div>
      <pre className="approval-banner-summary" id={summaryId} tabIndex={0}>{summary}</pre>
      <div className="approval-banner-actions">
        <button
          type="button"
          className="approval-btn deny"
          onClick={() => onReply(approval.id, false)}
        >
          {tr("拒绝", "Deny")}
        </button>
        <button
          type="button"
          className="approval-btn allow"
          onClick={() => onReply(approval.id, true)}
        >
          {tr("允许一次", "Allow once")}
        </button>
      </div>
    </div>
  );
}
