import { conflictingConversations, overlapsForConversation, type ConversationEditSummary } from "@vela/shared";
import { useContext, useEffect, useId, useRef, useState } from "react";
import { localizeError, tr, trf } from "../locale";
import { ConflictContext } from "./conflict-context";
import "../conflict.css";

const filesPerConversation = 8;

function ago(at: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 1) return tr("刚刚", "just now");
  if (minutes < 60) return trf("{0} 分钟前", "{0} min ago", minutes);
  return trf("{0} 小时前", "{0} h ago", Math.round(minutes / 60));
}

/** 把对话转到独立 worktree：新建分支与目录，并在其中新开对话。 */
export function MoveToWorktreeButton({ conversationId, compact = false, onMoved }: { conversationId: string; compact?: boolean; onMoved?: () => void }) {
  const { moveToWorktree } = useContext(ConflictContext);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await moveToWorktree(conversationId);
      onMoved?.();
    } catch (reason) {
      setError(localizeError(reason instanceof Error ? reason.message : tr("无法转到 worktree", "Could not move to a worktree")));
    } finally {
      setPending(false);
    }
  };
  return <>
    <button type="button" className={`conflict-move${compact ? " is-primary" : ""}`} disabled={pending} onClick={() => void run()}
      title={tr("从当前 HEAD 新建分支和独立 worktree，并在其中新开对话。原目录里未提交的改动不会搬过去。",
        "Create a branch and isolated worktree from HEAD and open a new chat there. Uncommitted edits in the original folder are not moved.")}>
      {pending ? tr("创建中…", "Creating…") : tr("转到独立 worktree", "Move to a worktree")}
    </button>
    {error ? <span className="conflict-error" role="alert">{error}</span> : null}
  </>;
}

function ConversationCard({ summary, now, onClose }: { summary: ConversationEditSummary; now: number; onClose: () => void }) {
  const { state, openConversation } = useContext(ConflictContext);
  const overlapPaths = new Set(overlapsForConversation(state, summary.conversationId).map(overlap => overlap.path));
  const others = conflictingConversations(state, summary.conversationId);
  return <li className={`conflict-card${overlapPaths.size > 0 ? " has-overlap" : ""}`}>
    <div className="conflict-card-head">
      <div style={{ minWidth: 0 }}>
        <button type="button" className="conflict-card-title" title={summary.title} onClick={() => { openConversation(summary.conversationId); onClose(); }}>{summary.title}</button>
        <div className="conflict-card-meta" title={summary.cwd}>{summary.cwd}</div>
      </div>
      {overlapPaths.size > 0 ? <div className="conflict-card-actions"><MoveToWorktreeButton conversationId={summary.conversationId} onMoved={onClose} /></div> : null}
    </div>
    {others.length > 0 ? <div className="conflict-overlap-who">
      {trf("与「{0}」改了同一处", "Overlaps with “{0}”", others.map(item => item.title).join(tr("、", ", ")))}
    </div> : null}
    <ul className="conflict-files">
      {summary.files.slice(0, filesPerConversation).map(file => <li key={file.path}>
        {overlapPaths.has(file.path) ? <span className="conflict-flag">{tr("重叠", "Overlap")}</span> : null}
        <code title={file.path}>{file.relativePath}</code>
        <time dateTime={new Date(file.editedAt).toISOString()}>{ago(file.editedAt, now)}</time>
      </li>)}
      {summary.files.length > filesPerConversation
        ? <li><span style={{ color: "var(--text-muted)" }}>{trf("另有 {0} 个文件", "{0} more file(s)", summary.files.length - filesPerConversation)}</span></li> : null}
    </ul>
  </li>;
}

/** 各对话近期改过的文件，以及被多个对话改过的重叠文件。 */
export function ConflictDialog({ onClose }: { onClose: () => void }) {
  const { state } = useContext(ConflictContext);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const now = Date.now();
  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (opener instanceof HTMLElement && opener.isConnected && !opener.closest("[inert]")) opener.focus();
    };
  }, []);
  const hours = Math.round(state.windowMs / 3_600_000);
  return <dialog ref={dialogRef} className="conflict-dialog" aria-labelledby={headingId} onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === dialogRef.current) onClose(); }}>
    <header>
      <h2 id={headingId}>{tr("各对话的近期改动", "Recent edits across chats")}</h2>
      <button type="button" aria-label={tr("关闭", "Close")} onClick={onClose}>×</button>
    </header>
    <p className="conflict-dialog-note">
      {trf("只统计最近 {0} 小时内对话通过 edit / write 改过的文件；通过命令行（bash）或外部程序造成的改动无法归到某个对话。不同 worktree 里的同名文件不算重叠。",
        "Counts files chats edited with edit / write in the last {0} hours. Changes made through shell commands or other programs cannot be attributed to a chat. Same-named files in different worktrees do not overlap.", hours)}
    </p>
    <div className="conflict-dialog-body">
      {state.error ? <p className="conflict-error" role="alert">{localizeError(state.error)}</p> : null}
      {state.conversations.length === 0
        ? <p className="conflict-empty">{tr("最近没有对话改过文件。", "No chat has edited files recently.")}</p>
        : <>
          {state.overlaps.length > 0 ? <>
            <h3>{trf("重叠的文件（{0}）", "Overlapping files ({0})", state.overlaps.length)}</h3>
            <ul className="conflict-list">
              {state.overlaps.map(overlap => <li className="conflict-card has-overlap" key={overlap.path}>
                <code title={overlap.path}>{overlap.relativePath}</code>
                <div className="conflict-overlap-who">
                  {overlap.conversations.map(entry => `${entry.title}（${ago(entry.editedAt, now)}）`).join(tr("、", ", "))}
                </div>
              </li>)}
            </ul>
          </> : <p className="conflict-dialog-note" style={{ padding: "8px 0 0" }}>{tr("目前没有文件被多个对话同时改动。", "No file is being edited by more than one chat.")}</p>}
          <h3>{trf("对话（{0}）", "Chats ({0})", state.conversations.length)}</h3>
          <ul className="conflict-list">
            {state.conversations.map(summary => <ConversationCard key={summary.conversationId} summary={summary} now={now} onClose={onClose} />)}
          </ul>
        </>}
    </div>
  </dialog>;
}
