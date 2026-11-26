import { tr, trf } from "../../locale";
import type { TurnChanges } from "../turn-changes";

export function ChangeSummaryPill({ changes, onReview }: { changes: TurnChanges; onReview: () => void }) {
  return (
    <button type="button" className="composer-change-summary" title={tr("变更审查", "Change review")} onClick={onReview}>
      <span>{trf("{0} 个文件已更改", changes.files.length === 1 ? "{0} file changed" : "{0} files changed", changes.files.length)}</span>
      <span className="turn-changes-added">+{changes.added}</span>
      <span className="turn-changes-removed">−{changes.removed}</span>
    </button>
  );
}
