import { conflictingConversations } from "@vela/shared";
import { useContext, useMemo, useState } from "react";
import { tr, trf } from "../locale";
import { ConflictContext } from "./conflict-context";
import { MoveToWorktreeButton } from "./ConflictDialog";
import "../conflict.css";

const shownFiles = 3;

/** 当前对话和其他对话近期改了同一个文件时的提醒；只管这一个对话，全局概览在 ConflictDialog。 */
export function ConflictBanner({ conversationId }: { conversationId: string | null | undefined }) {
  const { state, openOverview } = useContext(ConflictContext);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const others = useMemo(() => conversationId ? conflictingConversations(state, conversationId) : [], [state, conversationId]);
  if (!conversationId || others.length === 0) return null;
  // 同一批冲突只关闭一次；出现新的重叠文件后再次提醒。
  const signature = `${conversationId}:${others.map(item => `${item.conversationId}=${item.files.join("|")}`).join(";")}`;
  if (dismissed === signature) return null;
  const files = [...new Set(others.flatMap(item => item.files))];
  const names = others.map(item => item.title).slice(0, 2).join(tr("、", ", "));
  const more = others.length > 2 ? trf(" 等 {0} 个对话", " and {0} more", others.length - 2) : "";
  return <aside className="conflict-banner" role="status" aria-live="polite">
    <span className="conflict-banner-icon" aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 2.5v6.2a2.3 2.3 0 0 0 2.3 2.3H11" /><path d="M5 2.5 3 4.5M5 2.5l2 2" /><circle cx="12.5" cy="11" r="1.5" />
      </svg>
    </span>
    <div className="conflict-banner-text">
      <strong>{trf("{0} 个文件同时被其他对话修改", "{0} file(s) also edited in other chats", files.length)}</strong>
      <span>{trf("与「{0}」{1}改了同一处，各自的改动会互相覆盖或让对方读到过期内容。", "Shared with “{0}”{1}. Edits can overwrite each other or leave one chat reading stale content.", names, more)}</span>
      <span className="conflict-banner-files" title={files.join("\n")}>
        {files.slice(0, shownFiles).join(" · ")}{files.length > shownFiles ? ` +${files.length - shownFiles}` : ""}
      </span>
    </div>
    <div className="conflict-banner-actions">
      <MoveToWorktreeButton conversationId={conversationId} compact />
      <div className="conflict-links">
        <button type="button" className="conflict-link" onClick={openOverview}>{tr("查看全部", "View all")}</button>
        <button type="button" className="conflict-link" aria-label={tr("关闭提醒", "Dismiss")} onClick={() => setDismissed(signature)}>{tr("忽略", "Dismiss")}</button>
      </div>
    </div>
  </aside>;
}
