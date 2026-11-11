import { useEffect, useState } from "react";
import type { AppLocale, GitStatusSnapshot } from "@vela/shared";
import type { VersionControlApi } from "../../hooks/useVersionControl";
import { useDismissable } from "../../hooks/useDismissable";
import { tr, trf } from "../../locale";
import { AlertIcon, ChevronDownIcon } from "../icons";
import { formatRelativeTime } from "./time-format";

/** Shared status popover for both layouts. */
export function RepositoryStatus({ status, api, locale }: { status: GitStatusSnapshot; api: VersionControlApi; locale: AppLocale }) {
  const [open, setOpen] = useState(false);
  const ref = useDismissable<HTMLDivElement>(open, () => setOpen(false));
  useEffect(() => setOpen(false), [status.repo?.root]);
  return <div className="vc-sync" ref={ref}>
    <button type="button" className="vc-sync-summary" onClick={() => setOpen(value => !value)} aria-expanded={open}>
      {status.upstream ? <>
        <span className="vc-ahead">↑ {status.ahead} {tr("待推送", "to push")}</span>
        <span className="vc-behind">↓ {status.behind} {tr("待拉取", "to pull")}</span>
      </> : <span>{tr("尚未发布分支", "Branch not published")}</span>}
      <span>{status.lastFetchAt ? trf("Fetch {0}", "Fetched {0}", formatRelativeTime(status.lastFetchAt, locale)) : tr("尚未 Fetch", "Never fetched")}</span>
      <ChevronDownIcon size={10} />
    </button>
    {open ? <div className="vc-popover vc-status-popover">
      <div className="vc-status-row"><span>{tr("上游", "Upstream")}</span><b>{status.upstream ?? tr("无", "None")}</b></div>
      <div className="vc-status-row"><span>{tr("作者身份", "Author identity")}</span><b>{status.identity.configured ? `${status.identity.name} <${status.identity.email}>` : tr("未配置", "Not configured")}</b></div>
      <div className="vc-status-row"><span>{tr("远程", "Remotes")}</span><b>{status.remotes.length ? status.remotes.map(remote => remote.name).join(", ") : tr("无", "None")}</b></div>
      <div className="vc-status-row"><span>{tr("GitHub CLI", "GitHub CLI")}</span><b>{api.pr ? api.pr.ghAvailable ? tr("可用", "Available") : tr("不可用", "Unavailable") : tr("未检查", "Not checked")}</b></div>
      {status.operation ? <div className="vc-status-row vc-status-warn"><AlertIcon size={12} /><span>{trf("进行中的操作：{0}", "Operation in progress: {0}", status.operation.kind)}</span></div> : null}
      <div className="vc-status-row"><span>{tr("仓库范围", "Repository scope")}</span><b>{tr("文件读写使用仓库根语义", "File operations use the repository root")}</b></div>
    </div> : null}
  </div>;
}
