import { maxWorkspaceFolders, type WorkspaceRecent, type WorkspaceUpdateInput } from "@vela/shared";
import { useEffect, useId, useRef, useState } from "react";
import { localizeError, tr } from "../locale";
import { CloseIcon, FolderIcon, PlusIcon } from "./icons";
import { folderName } from "./workspace-names";

interface WorkspaceSettingsDialogProps {
  /** 要编辑的工作区;未登记的会话目录以只有主要文件夹的形式传入。 */
  workspace: WorkspaceRecent;
  onSave: (input: WorkspaceUpdateInput) => Promise<unknown>;
  onRemove: (path: string) => Promise<unknown>;
  onPickFolder: () => Promise<string | null>;
  onClose: () => void;
}

/** 编辑工作区:显示名、文件夹列表和主要文件夹。改动在点「保存」后才生效。 */
export function WorkspaceSettingsDialog({ workspace, onSave, onRemove, onPickFolder, onClose }: WorkspaceSettingsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const busyRef = useRef(false);
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [folders, setFolders] = useState<string[]>([workspace.path, ...(workspace.folders ?? [])]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headingId = useId();
  const nameId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (opener instanceof HTMLElement && opener.isConnected && !opener.closest("[inert]")) opener.focus();
    };
  }, []);

  async function run(action: () => Promise<unknown>): Promise<void> {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? localizeError(reason.message) : tr("操作失败，请重试", "Something went wrong. Try again."));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function addFolder(): Promise<void> {
    if (busyRef.current) return;
    const picked = await onPickFolder();
    if (!picked) return;
    const path = picked.replace(/\/+$/, "") || "/";
    setFolders((current) => {
      if (current.includes(path)) return current;
      return [...current, path];
    });
    setError(null);
  }

  const primary = folders[0];
  // 名字没动过时跟随主要文件夹:换主要文件夹后不会把旧文件夹名固化成自定义名。
  const effectiveName = nameTouched ? name.trim() : (workspace.displayName ?? "");
  const full = folders.length > maxWorkspaceFolders;

  return (
    <dialog
      ref={dialogRef}
      className="workspace-settings-dialog"
      aria-labelledby={headingId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busyRef.current) onClose();
      }}
      onKeyDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => {
        // 内容都在 form 里,事件目标是 dialog 本身说明点在遮罩上。
        if (event.target === event.currentTarget && !busyRef.current) onClose();
      }}
    >
      <form onSubmit={(event) => { event.preventDefault(); void run(() => onSave({ path: workspace.path, name: effectiveName || null, folders })); }}>
        <div className="workspace-settings-head">
          <h2 id={headingId}>{tr("编辑工作区", "Edit workspace")}</h2>
          <button type="button" className="workspace-settings-close" aria-label={tr("关闭", "Close")} disabled={busy} onClick={onClose}>
            <CloseIcon size={18} />
          </button>
        </div>
        <label className="workspace-settings-name" htmlFor={nameId}>
          <FolderIcon size={15} />
          <input
            id={nameId}
            value={nameTouched ? name : (workspace.displayName ?? folderName(primary))}
            maxLength={80}
            placeholder={folderName(primary)}
            readOnly={busy}
            onChange={(event) => { setName(event.target.value); setNameTouched(true); setError(null); }}
          />
        </label>
        <div className="workspace-settings-label">{tr("文件夹", "Folders")}</div>
        <div className="workspace-settings-folders">
          {folders.map((path, index) => (
            <div className="workspace-settings-row" key={path}>
              <FolderIcon size={15} />
              <span className="workspace-settings-folder" title={path}>{folderName(path)}</span>
              {index === 0 ? (
                <span className="workspace-settings-primary">{tr("主要", "Primary")}</span>
              ) : (
                <button
                  type="button"
                  className="workspace-settings-promote"
                  disabled={busy}
                  onClick={() => setFolders((current) => [path, ...current.filter((item) => item !== path)])}
                >
                  {tr("设为主要", "Make primary")}
                </button>
              )}
              <button
                type="button"
                className="workspace-settings-remove"
                title={tr("移除文件夹", "Remove folder")}
                aria-label={`${tr("移除文件夹", "Remove folder")} ${folderName(path)}`}
                disabled={busy || folders.length === 1}
                onClick={() => setFolders((current) => current.filter((item) => item !== path))}
              >
                <CloseIcon size={16} />
              </button>
            </div>
          ))}
          <button type="button" className="workspace-settings-add" disabled={busy || full} onClick={() => void addFolder()}>
            <PlusIcon size={15} />
            <span>{tr("添加文件夹", "Add folder")}</span>
          </button>
        </div>
        <p className="workspace-settings-hint">
          {tr(
            "Agent 可以读写所有文件夹；命令和相对路径以主要文件夹为准。",
            "The agent can read and write every folder; commands and relative paths use the primary folder.",
          )}
        </p>
        {error ? <p className="workspace-settings-error" role="alert">{error}</p> : null}
        <div className="workspace-settings-actions">
          <button
            type="button"
            className="workspace-settings-danger"
            disabled={busy}
            onClick={() => void run(() => onRemove(workspace.path))}
          >
            {tr("移除工作区", "Remove workspace")}
          </button>
          <span className="workspace-settings-spacer" />
          <button type="button" className="workspace-settings-cancel" disabled={busy} onClick={onClose}>{tr("取消", "Cancel")}</button>
          <button type="submit" className="workspace-settings-save" disabled={busy}>
            {busy ? tr("保存中…", "Saving…") : tr("保存", "Save")}
          </button>
        </div>
      </form>
    </dialog>
  );
}
