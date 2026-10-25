import { useEffect, useState } from "react";
import { tr } from "../locale";
import { TrashIcon } from "./icons";

/** 垃圾桶按钮：点一下变成「确认删除」，几秒内再点一次才执行，失焦或超时恢复。 */
export function ConfirmDeleteButton({ label, className, onConfirm }: {
  label: string;
  className?: string;
  onConfirm: () => void;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), 3000);
    return () => window.clearTimeout(timer);
  }, [armed]);
  return armed ? (
    <button type="button" className={`${className ?? ""} confirm-delete is-armed`} autoFocus
      onClick={(event) => { event.stopPropagation(); setArmed(false); onConfirm(); }}
      onBlur={() => setArmed(false)}>
      {tr("确认删除", "Confirm delete")}
    </button>
  ) : (
    <button type="button" className={`${className ?? ""} confirm-delete`} aria-label={label} title={label}
      onClick={(event) => { event.stopPropagation(); setArmed(true); }}>
      <TrashIcon size={14} />
    </button>
  );
}
