import {
  appendMemoryContent,
  buildMemoryUnifiedDiff,
  memoryFileMaxBytes,
  type MemoryDistillDraft,
  type MemoryDocument,
  type MemoryFailure,
  type MemoryRevision,
} from "@vela/shared";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { localizeError, tr, useAppLocale } from "../locale";
import { DiffPane } from "./DiffPane";
import { memoryBytes, memoryErrorText, memoryOverLimit, memoryUnexpectedError } from "./memory-settings-model";
import { settingsCopy } from "./settings-copy";
import { Icon } from "./icons";
import "../memory-distill.css";

export interface MemoryDistillDialogProps {
  conversationId: string;
  /** 可选：只提炼截至该用户轮次为止的对话内容。 */
  upToTurn?: number;
  onSaved?: (document: MemoryDocument) => void;
  onClose: () => void;
}

/** 提炼对话经验到项目 MEMORY.md：先由模型抽取，再经 Diff 预览确认后追加写入。 */
export function MemoryDistillDialog({ conversationId, upToTurn, onSaved, onClose }: MemoryDistillDialogProps) {
  const locale = useAppLocale();
  const copy = useMemo(() => settingsCopy(locale).memory, [locale]);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const savingRef = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const [draft, setDraft] = useState<MemoryDistillDraft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [baseContent, setBaseContent] = useState("");
  const [baseRevision, setBaseRevision] = useState<MemoryRevision>("");
  const [exists, setExists] = useState(false);
  const [addition, setAddition] = useState("");
  const [view, setView] = useState<"diff" | "edit">("diff");
  const [saving, setSaving] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [saveError, setSaveError] = useState<MemoryFailure | null>(null);
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
    setDraft(null);
    setLoadError(null);
    setSaveError(null);
    api.distillMemory({
      conversationId,
      locale,
      requestId,
      ...(upToTurn !== undefined ? { upToTurn } : {}),
    }).then(next => {
      if (!active) return;
      setDraft(next);
      setBaseContent(next.baseContent);
      setBaseRevision(next.baseRevision);
      setExists(next.exists);
      setAddition(next.addition);
      setView("diff");
    }).catch(reason => {
      if (!active) return;
      setLoadError(reason instanceof Error ? localizeError(reason.message) : tr("无法提炼项目记忆", "Could not distill project memory."));
    });
    return () => {
      active = false;
      void api.cancelMemoryDistill(requestId).catch(() => undefined);
    };
  }, [conversationId, upToTurn, locale, attempt]);

  useEffect(() => {
    if (view === "edit") editRef.current?.focus();
  }, [view]);

  const nextContent = useMemo(() => appendMemoryContent(baseContent, addition), [baseContent, addition]);
  const diffText = useMemo(
    () => (draft ? buildMemoryUnifiedDiff(draft.path, baseContent, nextContent) : ""),
    [draft, baseContent, nextContent],
  );
  const totalBytes = useMemo(() => memoryBytes(nextContent), [nextContent]);
  const overLimit = useMemo(() => memoryOverLimit(nextContent), [nextContent]);
  const canSave = Boolean(draft && addition.trim() && diffText && !overLimit && !saving && !reloading);

  async function reloadLatest(): Promise<void> {
    const memory = window.vela?.memory;
    if (!draft || !memory || reloading || saving) return;
    setReloading(true);
    setSaveError(null);
    try {
      const result = await memory.read({ scope: "project", workspace: draft.workspace });
      if (!result.ok) {
        setSaveError(result.error);
        return;
      }
      setBaseContent(result.value.content);
      setBaseRevision(result.value.revision);
      setExists(result.value.exists);
    } catch (error) {
      setSaveError({ code: "io-error", message: memoryUnexpectedError(error, copy), path: draft.path });
    } finally {
      setReloading(false);
    }
  }

  async function confirm(): Promise<void> {
    const memory = window.vela?.memory;
    if (!draft || !canSave || savingRef.current) return;
    if (!memory) {
      setSaveError({ code: "unavailable", message: copy.unavailable, path: draft.path });
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      const result = await memory.save({
        scope: "project",
        workspace: draft.workspace,
        content: nextContent,
        expectedRevision: baseRevision,
      });
      if (!result.ok) {
        setSaveError(result.error);
        return;
      }
      onSaved?.(result.value);
      onClose();
    } catch (error) {
      setSaveError({ code: "io-error", message: memoryUnexpectedError(error, copy), path: draft.path });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const showEmptyNotice = Boolean(draft && !draft.addition.trim() && !addition.trim() && view === "diff");

  return (
    <dialog
      ref={dialogRef}
      className="modal modal-xl memory-distill-dialog"
      aria-labelledby={headingId}
      aria-busy={!draft && !loadError}
      onCancel={event => {
        event.preventDefault();
        if (!savingRef.current) onClose();
      }}
      onKeyDown={event => {
        event.stopPropagation();
        const composing = event.nativeEvent.isComposing || event.keyCode === 229;
        if (composing && (event.key === "Enter" || event.key === "Escape")) {
          event.preventDefault();
          return;
        }
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && canSave) {
          event.preventDefault();
          void confirm();
        }
      }}
    >
      <header className="modal-head">
        <h2 id={headingId}>{tr("提炼规范到项目记忆", "Distill conventions to project memory")}</h2>
        <button type="button" className="modal-close" aria-label={tr("关闭", "Close")} disabled={saving} onClick={onClose}><Icon name="close" size={18} /></button>
      </header>

      {!draft && !loadError ? (
        <div className="memory-distill-state" role="status">
          <span className="memory-distill-spinner" aria-hidden="true" />
          {tr("正在从对话提炼项目规范…", "Distilling project conventions from this chat…")}
        </div>
      ) : null}

      {loadError ? (
        <div className="memory-distill-state" role="alert">
          <p>{loadError}</p>
          <button type="button" onClick={() => setAttempt(value => value + 1)}>{tr("重试", "Retry")}</button>
        </div>
      ) : null}

      {draft ? (
        <div className="modal-body memory-distill-body">
          <div className="memory-distill-meta">
            <code>{draft.path}</code>
            {!exists ? <span className="memory-distill-badge">{tr("新建文件", "New file")}</span> : null}
            <span className={`memory-distill-size${overLimit ? " is-over" : ""}`}>
              {copy.byteCount(totalBytes)} / {memoryFileMaxBytes / 1024} KiB
            </span>
          </div>

          {draft.summary ? <p className="memory-distill-summary">{draft.summary}</p> : null}

          {showEmptyNotice ? (
            <div className="memory-distill-empty" role="note">
              <p>{tr("本次对话没有发现需要沉淀到项目 MEMORY.md 的新规范或约束。", "No new project conventions or constraints were found to add to MEMORY.md.")}</p>
              <button type="button" onClick={() => setView("edit")}>{tr("手动补充", "Add manually")}</button>
            </div>
          ) : (
            <>
              <div className="memory-distill-tabs" role="group" aria-label={tr("查看方式", "View")}>
                <button type="button" aria-pressed={view === "diff"} onClick={() => setView("diff")}>{tr("Diff 预览", "Diff preview")}</button>
                <button type="button" aria-pressed={view === "edit"} onClick={() => setView("edit")}>{tr("编辑追加内容", "Edit addition")}</button>
              </div>

              {view === "diff" ? (
                diffText ? (
                  <div className="memory-distill-diff" tabIndex={0} aria-label={tr("项目记忆变更预览", "Project memory diff preview")}>
                    <DiffPane path={draft.path} diff={diffText} mode="unified" showLineNumbers hideMeta />
                  </div>
                ) : (
                  <p className="memory-distill-empty-inline">{tr("追加内容为空，没有产生差异。", "Addition is empty; there are no changes to preview.")}</p>
                )
              ) : (
                <textarea
                  ref={editRef}
                  className="memory-distill-editor"
                  rows={8}
                  value={addition}
                  readOnly={saving}
                  spellCheck={false}
                  autoComplete="off"
                  aria-label={tr("待追加的项目记忆内容", "Project memory addition")}
                  onChange={event => {
                    setAddition(event.target.value);
                    setSaveError(null);
                  }}
                />
              )}
            </>
          )}

          {overLimit ? (
            <p className="memory-distill-error" role="alert">{copy.overLimit}</p>
          ) : saveError ? (
            <div className="memory-distill-error-row">
              <p className="memory-distill-error" role="alert">{memoryErrorText(saveError, copy)}</p>
              {saveError.code === "conflict" ? (
                <button type="button" disabled={saving || reloading} onClick={() => void reloadLatest()}>
                  {reloading ? tr("重新读取中…", "Reloading…") : tr("重新读取并合并", "Reload & re-merge")}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <footer className="modal-foot is-ruled">
        <button type="button" className="modal-btn" disabled={saving || reloading} onClick={onClose}>{tr("取消", "Cancel")}</button>
        <button type="button" className="modal-btn modal-btn-primary is-primary" disabled={!canSave} onClick={() => void confirm()}>
          {saving ? tr("写入中…", "Appending…") : tr("确认追加到 MEMORY.md", "Append to MEMORY.md")}
        </button>
      </footer>
    </dialog>
  );
}
