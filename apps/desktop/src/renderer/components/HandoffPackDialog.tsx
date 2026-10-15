import { renderHandoffText, type HandoffPack } from "@vela/shared";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { localizeError, tr, trf, useAppLocale } from "../locale";
import "../handoff-pack.css";

export interface HandoffPackDialogProps {
  conversationId: string;
  /** 不向模型发请求，只用记录里的事实整理；任务用量到上限后使用。 */
  factsOnly?: boolean;
  /** 用最终文本建立新对话并预填；失败时抛错，对话框保持打开。 */
  onConfirm: (text: string) => Promise<void>;
  onClose: () => void;
}

const lines = (text: string): string[] => text.split("\n").map(line => line.trim()).filter(Boolean);

function verificationLabel(result: "passed" | "failed" | "unknown"): string {
  return result === "passed" ? tr("通过", "Passed") : result === "failed" ? tr("失败", "Failed") : tr("结果不明", "Unknown");
}

/** 预览并编辑任务交接包：事实类内容（文件、验证）只能剔除，不能改写。 */
export function HandoffPackDialog({ conversationId, factsOnly = false, onConfirm, onClose }: HandoffPackDialogProps) {
  const locale = useAppLocale();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const goalRef = useRef<HTMLTextAreaElement>(null);
  const confirmingRef = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const [pack, setPack] = useState<HandoffPack | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [view, setView] = useState<"edit" | "preview">("edit");
  const [goal, setGoal] = useState("");
  const [decisions, setDecisions] = useState("");
  const [unfinished, setUnfinished] = useState("");
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<Set<string>>(new Set());
  const [verifications, setVerifications] = useState<Set<number>>(new Set());
  const headingId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (opener instanceof HTMLElement && opener.isConnected && !opener.closest("[inert]")) opener.focus();
    };
  }, []);

  useEffect(() => {
    const api = window.vela;
    if (!api) {
      setLoadError(tr("会话服务不可用", "Session service is unavailable."));
      return;
    }
    const requestId = crypto.randomUUID();
    let active = true;
    setPack(null);
    setLoadError(null);
    api.draftHandoff({ conversationId, locale, requestId, ...(factsOnly ? { factsOnly: true } : {}) }).then(next => {
      if (!active) return;
      setPack(next);
      setGoal(next.goal);
      setDecisions(next.decisions.join("\n"));
      setUnfinished(next.unfinished.join("\n"));
      setNotes("");
      setFiles(new Set(next.files.map(file => file.path)));
      setVerifications(new Set(next.verifications.map((_, index) => index)));
      setView("edit");
    }).catch(reason => {
      if (active) setLoadError(reason instanceof Error ? localizeError(reason.message) : tr("无法生成交接包", "Could not generate the handoff pack."));
    });
    return () => {
      active = false;
      void api.cancelHandoff(requestId).catch(() => undefined);
    };
  }, [conversationId, factsOnly, locale, attempt]);

  useEffect(() => {
    if (pack) goalRef.current?.focus();
  }, [pack]);

  const edited = useMemo<HandoffPack | null>(() => pack && {
    ...pack,
    goal,
    decisions: lines(decisions),
    unfinished: lines(unfinished),
    files: pack.files.filter(file => files.has(file.path)),
    verifications: pack.verifications.filter((_, index) => verifications.has(index)),
    notes,
  }, [pack, goal, decisions, unfinished, files, verifications, notes]);
  const text = useMemo(() => edited ? renderHandoffText(edited, locale) : "", [edited, locale]);

  async function confirm() {
    if (!edited || confirmingRef.current) return;
    confirmingRef.current = true;
    setConfirming(true);
    setConfirmError(null);
    try {
      await onConfirm(text);
      onClose();
    } catch (reason) {
      setConfirmError(reason instanceof Error ? localizeError(reason.message) : tr("无法创建新对话", "Could not create a new chat."));
    } finally {
      confirmingRef.current = false;
      setConfirming(false);
    }
  }

  function toggle<T>(set: Set<T>, value: T, apply: (next: Set<T>) => void) {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    apply(next);
  }

  return (
    <dialog
      ref={dialogRef}
      className="handoff-dialog"
      aria-labelledby={headingId}
      aria-busy={!pack && !loadError}
      onCancel={event => {
        event.preventDefault();
        if (!confirmingRef.current) onClose();
      }}
      onKeyDown={event => {
        event.stopPropagation();
        const composing = event.nativeEvent.isComposing || event.keyCode === 229;
        if (composing && (event.key === "Enter" || event.key === "Escape")) {
          event.preventDefault();
          return;
        }
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && pack) {
          event.preventDefault();
          void confirm();
        }
      }}
    >
      <header>
        <h2 id={headingId}>{tr("任务交接包", "Task handoff pack")}</h2>
        <button type="button" className="handoff-close" aria-label={tr("关闭", "Close")} disabled={confirming} onClick={onClose}>×</button>
      </header>

      {!pack && !loadError ? (
        <div className="handoff-state" role="status">
          <span className="handoff-spinner" aria-hidden="true" />
          {tr("正在整理这个对话…", "Putting this chat together…")}
        </div>
      ) : null}

      {loadError ? (
        <div className="handoff-state" role="alert">
          <p>{loadError}</p>
          <button type="button" onClick={() => setAttempt(value => value + 1)}>{tr("重试", "Retry")}</button>
        </div>
      ) : null}

      {pack ? (
        <div className="handoff-body">
          {pack.source === "facts-only" ? (
            <p className="handoff-notice" role="note">
              {tr("没有使用模型，只包含对话记录里的事实；目标和未完成事项可以在下面补充。", "No model was used, so this only contains facts from the chat record. Fill in the goal and unfinished items below.")}
            </p>
          ) : null}
          <div className="handoff-tabs" role="group" aria-label={tr("查看方式", "View")}>
            <button type="button" aria-pressed={view === "edit"} onClick={() => setView("edit")}>{tr("编辑", "Edit")}</button>
            <button type="button" aria-pressed={view === "preview"} onClick={() => setView("preview")}>{tr("预览", "Preview")}</button>
          </div>

          {view === "preview" ? (
            <pre className="handoff-preview" tabIndex={0} aria-label={tr("交接包预览", "Handoff pack preview")}>{text}</pre>
          ) : (
            <>
              <label className="handoff-field">
                <span>{tr("目标", "Goal")}</span>
                <textarea ref={goalRef} rows={2} value={goal} readOnly={confirming} onChange={event => setGoal(event.target.value)} />
              </label>
              <label className="handoff-field">
                <span>{tr("已确认决策", "Confirmed decisions")}<em>{tr("每行一项", "One per line")}</em></span>
                <textarea rows={3} value={decisions} readOnly={confirming} onChange={event => setDecisions(event.target.value)} />
              </label>

              <fieldset className="handoff-group">
                <legend>{tr("修改文件", "Modified files")}</legend>
                {pack.files.length === 0 ? <p className="handoff-empty">{tr("没有记录到文件修改", "No file changes were recorded")}</p> : (
                  <ul>
                    {pack.files.map(file => (
                      <li key={file.path}>
                        <label>
                          <input type="checkbox" checked={files.has(file.path)} disabled={confirming}
                            onChange={() => toggle(files, file.path, setFiles)} />
                          <code>{file.path}</code>
                          {file.added || file.removed ? <span className="handoff-counts">+{file.added} −{file.removed}</span> : null}
                          {file.origin === "disk" ? <em>{tr("磁盘检测", "Found on disk")}</em> : null}
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
                {pack.omittedFiles > 0 ? <p className="handoff-empty">{trf("另有 {0} 个文件未列出", "{0} more files not listed", pack.omittedFiles)}</p> : null}
              </fieldset>

              <fieldset className="handoff-group">
                <legend>{tr("实际验证", "Verification actually run")}</legend>
                {pack.verifications.length === 0 ? <p className="handoff-empty">{tr("上一个对话没有记录任何验证", "No verification was recorded in the previous chat")}</p> : (
                  <ul>
                    {pack.verifications.map((item, index) => (
                      <li key={index}>
                        <label>
                          <input type="checkbox" checked={verifications.has(index)} disabled={confirming}
                            onChange={() => toggle(verifications, index, setVerifications)} />
                          <span className={`handoff-result is-${item.result}`}>{verificationLabel(item.result)}</span>
                          <code>{item.command}</code>
                          {item.stale ? <em>{tr("之后文件又被修改，可能已过期", "Files changed afterwards; may be outdated")}</em> : null}
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
                {pack.omittedVerifications > 0 ? <p className="handoff-empty">{trf("另有 {0} 条验证未列出", "{0} more verifications not listed", pack.omittedVerifications)}</p> : null}
                <p className="handoff-hint">{tr("文件和验证来自实际记录，只能取消勾选，不能改写。", "Files and verification come from the record; you can leave items out but not rewrite them.")}</p>
              </fieldset>

              <label className="handoff-field">
                <span>{tr("未完成事项", "Unfinished items")}<em>{tr("每行一项", "One per line")}</em></span>
                <textarea rows={3} value={unfinished} readOnly={confirming} onChange={event => setUnfinished(event.target.value)} />
              </label>
              <label className="handoff-field">
                <span>{tr("补充说明", "Notes")}</span>
                <textarea rows={2} value={notes} readOnly={confirming} onChange={event => setNotes(event.target.value)} />
              </label>
            </>
          )}
          {confirmError ? <p className="handoff-error" role="alert">{confirmError}</p> : null}
        </div>
      ) : null}

      <footer>
        <button type="button" disabled={confirming} onClick={onClose}>{tr("取消", "Cancel")}</button>
        <button type="button" className="is-primary" disabled={!pack || confirming} onClick={() => void confirm()}>
          {confirming ? tr("创建中…", "Creating…") : tr("创建新对话并填入", "Start new chat with this")}
        </button>
      </footer>
    </dialog>
  );
}
