import { useId, useLayoutEffect, useRef } from "react";
import { tr } from "../locale";

/** Compact in-app confirmation; the terminal remains mounted until explicit approval. */
export function TerminalCloseDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId(), detailId = useId();

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement;
    dialog?.showModal();
    cancelRef.current?.focus();
    return () => {
      dialog?.close();
      if (opener instanceof HTMLElement && opener.isConnected && !opener.closest("[inert]")) opener.focus();
    };
  }, []);

  return <dialog ref={dialogRef} className="terminal-close-dialog" role="alertdialog" aria-labelledby={titleId} aria-describedby={detailId}
    onCancel={event => { event.preventDefault(); onCancel(); }}
    onKeyDown={event => {
      event.stopPropagation();
      if ((event.key === "Enter" || event.key === "Escape") && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault();
    }}>
    <h2 id={titleId}>{tr("关闭正在运行命令的终端？", "Close the terminal with a running command?")}</h2>
    <p id={detailId}>{tr("此终端可能仍有命令在运行。关闭标签页将终止正在运行的命令。", "This terminal may still have running commands. Closing the tab will terminate them.")}</p>
    <div className="terminal-close-actions">
      <button ref={cancelRef} type="button" className="terminal-close-cancel" onClick={onCancel}>{tr("取消", "Cancel")}</button>
      <button type="button" onClick={onConfirm}>{tr("终止命令并关闭", "Terminate and close")}</button>
    </div>
  </dialog>;
}
