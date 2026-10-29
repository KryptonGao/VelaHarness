import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { BranchSummary, GitCommitSummary } from "@vela/shared";
import { useDismissable } from "../hooks/useDismissable";
import { tr } from "../locale";
import { ArrowLeftIcon, CheckIcon, ChevronDownIcon, ChevronRightIcon } from "./icons";
import type { ChangesCategory } from "./workspace-changes";

export function categoryLabel(category: ChangesCategory): string {
  switch (category) {
    case "last-turn": return tr("上一轮", "Last turn");
    case "uncommitted": return tr("未提交", "Uncommitted");
    case "unstaged": return tr("未暂存", "Unstaged");
    case "staged": return tr("已暂存", "Staged");
    case "committed": return tr("已提交", "Committed");
    case "branch": return tr("分支", "Branch");
  }
}

export function ChangesFilter({ category, onSelect, onRequestCommits, commits, commitsLoading, commitsError, branches, commitSha, baseBranch, visible }: {
  category: ChangesCategory;
  onSelect: (category: ChangesCategory, ref?: string) => void;
  onRequestCommits: () => void;
  commits: GitCommitSummary[];
  commitsLoading: boolean;
  commitsError: boolean;
  branches: BranchSummary[];
  commitSha: string | null;
  baseBranch: string | null;
  visible: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<"committed" | "branch" | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = () => { setOpen(false); setPage(null); };
  const openPage = (next: "committed" | "branch") => {
    if (next === "committed") onRequestCommits();
    setPage(next);
  };
  const root = useDismissable<HTMLDivElement>(open, close);
  useEffect(() => { if (!visible) close(); }, [visible]);
  useEffect(() => {
    if (open) menu.current?.querySelector<HTMLButtonElement>('[role^="menuitem"]')?.focus();
  }, [open, page]);
  const select = (value: ChangesCategory, ref?: string) => {
    onSelect(value, ref);
    close();
    trigger.current?.focus();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && open) {
      event.preventDefault(); event.stopPropagation();
      if (page) setPage(null); else { close(); trigger.current?.focus(); }
      return;
    }
    if (event.key === "ArrowLeft" && page) { event.preventDefault(); setPage(null); return; }
    if (!open || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)') ?? [])];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    items[event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
      : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
  };
  const commit = commits.find(item => item.sha === commitSha);
  const detail = category === "committed" ? commit?.shortSha : category === "branch" ? baseBranch : null;
  const categories: ChangesCategory[] = ["last-turn", "uncommitted", "unstaged", "staged", "committed", "branch"];
  return <div ref={root} className="changes-filter" onKeyDownCapture={onKeyDown}>
    <button ref={trigger} type="button" className="changes-filter-trigger" aria-label={tr("变更分类", "Change category")}
      aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => { setOpen(value => !value); setPage(null); }}
      onKeyDown={event => { if (!open && ["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); setOpen(true); } }}>
      <span>{categoryLabel(category)}{detail ? <span className="changes-filter-detail">{detail}</span> : null}</span><ChevronDownIcon />
    </button>
    {open ? <div id={id} ref={menu} className="changes-filter-menu" role="menu" aria-label={tr("变更分类", "Change category")}>
      {page ? <>
        <button type="button" role="menuitem" className="changes-filter-item changes-filter-back" onClick={() => setPage(null)}>
          <ArrowLeftIcon /><span>{categoryLabel(page)}</span>
        </button>
        <div role="separator" className="changes-filter-separator" />
        <div className="changes-filter-options">
          {page === "committed" ? commits.map(item => <button key={item.sha} type="button" role="menuitemradio"
            aria-checked={category === "committed" && commitSha === item.sha} className="changes-filter-item"
            title={`${item.shortSha} ${item.subject}`} onClick={() => select("committed", item.sha)}>
            <span className="changes-filter-commit"><span>{item.subject}</span><small>{item.shortSha}</small></span>
            {category === "committed" && commitSha === item.sha ? <CheckIcon /> : null}
          </button>) : branches.map(item => <button key={item.name} type="button" role="menuitemradio"
            aria-checked={category === "branch" && baseBranch === item.name} className="changes-filter-item"
            title={item.name} onClick={() => select("branch", item.name)}>
            <span>{item.name}</span>{category === "branch" && baseBranch === item.name ? <CheckIcon /> : null}
          </button>)}
          {page === "committed" && commits.length === 0 ? <div className="changes-filter-empty" role="status">{commitsLoading
            ? tr("正在读取提交…", "Loading commits…") : commitsError ? tr("加载变更失败", "Failed to load changes") : tr("没有提交记录", "No commits yet")}</div> : null}
          {page === "branch" && branches.length === 0 ? <div className="changes-filter-empty">{tr("没有可比较的分支", "No branches to compare")}</div> : null}
        </div>
      </> : categories.map((item, index) => <div key={item}>
        {index === 1 || index === 4 ? <div role="separator" className="changes-filter-separator" /> : null}
        <button type="button" className="changes-filter-item" role={item === "committed" || item === "branch" ? "menuitem" : "menuitemradio"}
          aria-checked={item === "committed" || item === "branch" ? undefined : category === item}
          aria-haspopup={item === "committed" || item === "branch" ? "menu" : undefined}
          onKeyDown={event => { if (event.key === "ArrowRight" && (item === "committed" || item === "branch")) { event.preventDefault(); openPage(item); } }}
          onClick={() => item === "committed" || item === "branch" ? openPage(item) : select(item)}>
          <span>{categoryLabel(item)}</span>
          {category === item ? <CheckIcon /> : item === "committed" || item === "branch" ? <ChevronRightIcon /> : null}
        </button>
      </div>)}
    </div> : null}
  </div>;
}
