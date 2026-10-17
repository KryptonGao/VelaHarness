import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useEscapeKey } from "../hooks/useDismissable";
import { tr, trf } from "../locale";
import { DiffPane, isAddedOnlyDiff } from "./DiffPane";
import { FileTypeIcon } from "./FileTypeIcon";
import { FileIcon, FolderIcon, SearchIcon } from "./icons";
import type { TurnFileChange, TurnReviewRequest } from "./turn-changes";

interface Directory {
  name: string;
  path: string;
  directories: Directory[];
  files: TurnFileChange[];
}

function fileTree(files: TurnFileChange[]): Directory {
  const root: Directory = { name: "", path: "", directories: [], files: [] };
  for (const file of files) {
    const parts = file.path.split("/");
    let directory = root;
    for (const part of parts.slice(0, -1)) {
      const path = `${directory.path}/${part}`;
      let child = directory.directories.find(item => item.path === path);
      if (!child) {
        child = { name: part || "/", path, directories: [], files: [] };
        directory.directories.push(child);
      }
      directory = child;
    }
    directory.files.push(file);
  }
  return root;
}

function ChangeStats({ added, removed }: { added: number; removed: number }) {
  return <span className="turn-review-stats" aria-label={trf("增加 {0} 行，删除 {1} 行", "{0} lines added, {1} removed", added, removed)}>
    <span className="turn-changes-added">+{added}</span>
    <span className="turn-changes-removed">−{removed}</span>
  </span>;
}

export interface TurnReviewTarget {
  path: string;
  requestKey: number;
  diffToolId?: string;
}

export function TurnReviewView({ review, visible, onClose, target, title, filesLabel, emptyLabel }: {
  review: TurnReviewRequest;
  visible: boolean;
  onClose: () => void;
  target?: TurnReviewTarget;
  /** 工具栏标题;默认「本轮变更」。 */
  title?: string;
  /** 侧栏文件树的无障碍名称。 */
  filesLabel?: string;
  /** 没有任何变更文件时的提示;默认「没有匹配的文件」。 */
  emptyLabel?: string;
}) {
  const { changes } = review;
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(changes.files[0]?.path ?? null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [compact, setCompact] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const id = useId();
  const scroller = useRef<HTMLDivElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const sections = useRef(new Map<string, HTMLElement>());
  const edits = useRef(new Map<string, HTMLElement>());
  const appliedTarget = useRef<string | null>(null);
  const targetScroll = useRef<{ path: string; top: number } | null>(null);
  const frame = useRef(0);
  const contentRef = useEscapeKey<HTMLDivElement>(visible, () => {
    if (drawerOpen) {
      setDrawerOpen(false);
      toggle.current?.focus();
    } else onClose();
  });
  const noChanges = changes.files.length === 0;
  const files = useMemo(() => {
    const query = filter.trim().toLocaleLowerCase();
    return changes.files.filter(file => file.path.toLocaleLowerCase().includes(query));
  }, [changes.files, filter]);
  const tree = useMemo(() => fileTree(files), [files]);

  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setCompact(entry.contentRect.width < 600);
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, [contentRef]);

  useEffect(() => {
    if (!visible || !compact) setDrawerOpen(false);
  }, [visible, compact]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !sidebar.current?.contains(event.target) && !toggle.current?.contains(event.target)) {
        setDrawerOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    sidebar.current?.querySelector<HTMLInputElement>("input")?.focus();
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [drawerOpen]);

  // 只在文件集合变化时回到顶部;同一批文件的差异刷新不打断阅读位置。
  const filesKey = files.map(file => file.path).join("\0");
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
    setSelected(files[0]?.path ?? null);
    setCollapsed(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filesKey]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const onScroll = () => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const scroll = scroller.current;
      if (!scroll) return;
      if (targetScroll.current && Math.abs(scroll.scrollTop - Math.min(targetScroll.current.top, scroll.scrollHeight - scroll.clientHeight)) < 1) {
        setSelected(targetScroll.current.path);
        return;
      }
      targetScroll.current = null;
      const top = scroll.getBoundingClientRect().top;
      let active: string | null = files[0]?.path ?? null;
      for (const file of files) {
        const section = sections.current.get(file.path);
        if (section && section.getBoundingClientRect().top <= top + 42) active = file.path;
        else break;
      }
      if (scroll.scrollTop > 0 && scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 1) {
        active = files.at(-1)?.path ?? null;
      }
      setSelected(active);
    });
  };

  const selectFile = (path: string) => {
    const section = sections.current.get(path);
    const scroll = scroller.current;
    if (section && scroll) {
      scroll.scrollTo({ top: scroll.scrollTop + section.getBoundingClientRect().top - scroll.getBoundingClientRect().top });
    }
    setSelected(path);
    if (compact) {
      setDrawerOpen(false);
      toggle.current?.focus();
    }
  };

  useEffect(() => {
    if (!visible || !target) return;
    const key = JSON.stringify([review.turnId, target.path, target.requestKey, target.diffToolId]);
    if (appliedTarget.current === key || !changes.files.some(file => file.path === target.path)) return;
    if (filter) { setFilter(""); return; }
    const section = (target.diffToolId && edits.current.get(target.diffToolId)) || sections.current.get(target.path);
    const scroll = scroller.current;
    if (!section || !scroll) return;
    appliedTarget.current = key;
    const top = scroll.scrollTop + section.getBoundingClientRect().top - scroll.getBoundingClientRect().top;
    targetScroll.current = { path: target.path, top };
    scroll.scrollTo({ top });
    setSelected(target.path);
    setCollapsed(current => new Set([...current].filter(path => !`/${target.path}`.startsWith(`${path}/`))));
    setDrawerOpen(false);
  }, [visible, target?.path, target?.requestKey, target?.diffToolId, review.turnId, changes.files, filter]);

  const renderDirectory = (directory: Directory) => <ul className="turn-review-tree-list">
    {directory.directories.map(child => {
      const open = !collapsed.has(child.path);
      return <li key={child.path}>
        <button type="button" className="turn-review-directory" aria-expanded={open}
          onClick={() => setCollapsed(current => {
            const next = new Set(current);
            if (next.has(child.path)) next.delete(child.path);
            else next.add(child.path);
            return next;
          })}>
          <svg className={`turn-review-chevron${open ? " open" : ""}`} width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 3 5 5-5 5" /></svg>
          <FolderIcon size={13} /><span>{child.name}</span>
        </button>
        {open ? renderDirectory(child) : null}
      </li>;
    })}
    {directory.files.map(file => <li key={file.path}>
      <button type="button" className={`turn-review-file-link${selected === file.path ? " active" : ""}`}
        title={file.path} aria-current={selected === file.path ? "location" : undefined} onClick={() => selectFile(file.path)}>
        <FileTypeIcon path={file.path} /><span className="turn-review-file-name">{file.path.split("/").at(-1)}</span>
        <ChangeStats added={file.added} removed={file.removed} />
      </button>
    </li>)}
  </ul>;

  return <div ref={contentRef} className={`turn-review-view${compact ? " is-compact" : ""}${drawerOpen ? " is-drawer-open" : ""}`}
    role="region" aria-labelledby={`${id}-title`}>
    <header className="turn-review-toolbar">
      <FileIcon size={14} /><strong id={`${id}-title`}>{title ?? tr("本轮变更", "Turn changes")}</strong>
      <span className="turn-review-count">{trf("{0} 个文件", "{0} files", changes.files.length)}</span>
      <ChangeStats added={changes.added} removed={changes.removed} />
      {compact ? <button ref={toggle} type="button" className="turn-review-files-toggle" aria-controls={`${id}-files`}
        aria-expanded={drawerOpen} onClick={() => setDrawerOpen(open => !open)}>
        <FolderIcon size={14} />{tr("文件", "Files")}
      </button> : null}
    </header>
    <div className="turn-review-body">
      <div className="turn-review-scroll" ref={scroller} onScroll={onScroll}>
        {files.map(file => <section key={file.path} className="turn-review-file"
          ref={node => { if (node) sections.current.set(file.path, node); else sections.current.delete(file.path); }}
          aria-label={file.path}>
          <header className="turn-review-file-header">
            <FileTypeIcon path={file.path} /><strong title={file.path}>{file.path}</strong>
            <ChangeStats added={file.added} removed={file.removed} />
          </header>
          {file.diffs.some(diff => diff && !isAddedOnlyDiff(diff, file.format ?? "tool"))
            ? <div className="turn-review-side-labels"><span>{tr("编辑前", "Before")}</span><span>{tr("编辑后", "After")}</span></div> : null}
          {file.diffs.length > 0 ? file.diffs.map((diff, index) => {
            const toolIds = file.diffToolIds;
            const toolId = toolIds?.[index];
            return <div className="turn-review-edit" key={index} data-diff-tool-id={toolId}
              ref={node => { if (!toolId) return; if (node) edits.current.set(toolId, node); else edits.current.delete(toolId); }}>
            {file.diffs.length > 1 ? <div className="turn-review-edit-label">{trf("编辑 {0} / {1}", "Edit {0} / {1}", index + 1, file.diffs.length)}</div> : null}
            {diff ? <DiffPane path={file.path} diff={diff} mode="split" format={file.format ?? "tool"} showLineNumbers hideMeta />
              : <div className="turn-review-empty">{tr("这项编辑没有保存可显示的差异", "No saved diff is available for this edit")}</div>}
          </div>; }) : <div className="turn-review-empty">{tr("这项编辑没有保存可显示的差异", "No saved diff is available for this edit")}</div>}
        </section>)}
        {files.length === 0 ? <div className="turn-review-empty">{noChanges && emptyLabel ? emptyLabel : tr("没有匹配的文件", "No matching files")}</div> : null}
      </div>
      <nav id={`${id}-files`} ref={sidebar} className="turn-review-sidebar" aria-label={filesLabel ?? tr("本轮变更文件", "Files changed in this turn")}
        hidden={compact && !drawerOpen}>
        <label className="turn-review-filter"><SearchIcon size={14} />
          <input value={filter} onChange={event => setFilter(event.target.value)}
            aria-label={tr("筛选文件", "Filter files")} placeholder={tr("筛选文件…", "Filter files…")} />
        </label>
        <div className="turn-review-tree">{renderDirectory(tree)}
          {files.length === 0 ? <div className="turn-review-empty">{tr("没有匹配的文件", "No matching files")}</div> : null}
        </div>
      </nav>
    </div>
  </div>;
}
