import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useEscapeKey } from "../hooks/useDismissable";
import { tr, trf } from "../locale";
import { DiffPane, isAddedOnlyDiff } from "./DiffPane";
import { FileTypeIcon } from "./FileTypeIcon";
import { FileIcon, FolderIcon, SearchIcon } from "./icons";
import { FileTree } from "./preview/ExplorerPane";
import { buildFileTree, type FileTreeNode } from "./preview/tree";
import type { TurnReviewRequest } from "./turn-changes";

function directoryPaths(nodes: FileTreeNode[], into = new Set<string>()): Set<string> {
  for (const node of nodes) {
    if (node.type !== "dir") continue;
    into.add(node.path);
    if (node.children) directoryPaths(node.children, into);
  }
  return into;
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

const firstBatch = 3;
const nextBatch = 3;
/** 占位高度：按差异行数估算，对应拆分视图里每行的大致高度。 */
const placeholderLineHeight = 19;

function placeholderHeight(diffs: readonly string[]): number {
  const lines = diffs.reduce((sum, diff) => sum + (diff ? diff.split("\n").length : 2), 0);
  return Math.max(60, lines * placeholderLineHeight);
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
  const tree = useMemo(() => buildFileTree(files.map(file => file.path)), [files]);
  const stats = useMemo(() => new Map(files.map(file => [file.path, file])), [files]);
  // 变更树默认全部展开;只记录被用户收起的目录。
  const expanded = useMemo(() => {
    const open = directoryPaths(tree);
    for (const path of collapsed) open.delete(path);
    return open;
  }, [tree, collapsed]);

  // 几十个文件的差异一次挂载会长时间占住主线程（顶栏点不动）：先挂前几项，其余分批补上，
  // 没挂上的文件先按行数预留高度，滚动位置不会跳。
  const [mountedCount, setMountedCount] = useState(firstBatch);
  useEffect(() => {
    if (mountedCount >= files.length) return;
    const timer = window.setTimeout(() => setMountedCount(count => count + nextBatch), 32);
    return () => window.clearTimeout(timer);
  }, [mountedCount, files.length]);

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
    setCollapsed(current => new Set([...current].filter(path => !target.path.startsWith(`${path}/`))));
    setDrawerOpen(false);
  }, [visible, target?.path, target?.requestKey, target?.diffToolId, review.turnId, changes.files, filter]);

  const toggleDirectory = (path: string) => setCollapsed(current => {
    const next = new Set(current);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    return next;
  });

  // 展开/收起目录、滚动高亮只改侧栏状态;差异区单独缓存,避免几十个文件的 Diff 跟着重渲染。
  const sectionList = useMemo(() => (
    files.map((file, index) => <section key={file.path} className="turn-review-file"
        ref={node => { if (node) sections.current.set(file.path, node); else sections.current.delete(file.path); }}
        aria-label={file.path}>
        <header className="turn-review-file-header">
          <FileTypeIcon path={file.path} /><strong title={file.path}>{file.path}</strong>
          <ChangeStats added={file.added} removed={file.removed} />
        </header>
        {file.diffs.some(diff => diff && !isAddedOnlyDiff(diff, file.format ?? "tool"))
          ? <div className="turn-review-side-labels"><span>{tr("编辑前", "Before")}</span><span>{tr("编辑后", "After")}</span></div> : null}
        {index >= mountedCount && file.path !== target?.path
          ? <div className="turn-review-pending" style={{ height: placeholderHeight(file.diffs) }} aria-hidden="true" />
          : file.diffs.length > 0 ? file.diffs.map((diff, index) => {
          const toolIds = file.diffToolIds;
          const toolId = toolIds?.[index];
          return <div className="turn-review-edit" key={index} data-diff-tool-id={toolId}
            ref={node => { if (!toolId) return; if (node) edits.current.set(toolId, node); else edits.current.delete(toolId); }}>
          {file.diffs.length > 1 ? <div className="turn-review-edit-label">{trf("编辑 {0} / {1}", "Edit {0} / {1}", index + 1, file.diffs.length)}</div> : null}
          {diff ? <DiffPane path={file.path} diff={diff} mode="split" format={file.format ?? "tool"} showLineNumbers hideMeta />
            : <div className="turn-review-empty">{tr("这项编辑没有保存可显示的差异", "No saved diff is available for this edit")}</div>}
        </div>; }) : <div className="turn-review-empty">{tr("这项编辑没有保存可显示的差异", "No saved diff is available for this edit")}</div>}
      </section>)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [files, mountedCount, target?.path]);

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
        {sectionList}
        {files.length === 0 ? <div className="turn-review-empty">{noChanges && emptyLabel ? emptyLabel : tr("没有匹配的文件", "No matching files")}</div> : null}
      </div>
      <nav id={`${id}-files`} ref={sidebar} className="turn-review-sidebar preview-explorer-pane" aria-label={filesLabel ?? tr("本轮变更文件", "Files changed in this turn")}
        hidden={compact && !drawerOpen}>
        <div className="explorer-search-row">
          <label className="explorer-search-field"><SearchIcon size={13} />
            <input className="explorer-search-input" type="text" value={filter} onChange={event => setFilter(event.target.value)}
              aria-label={tr("筛选文件", "Filter files")} placeholder={tr("筛选文件…", "Filter files…")} />
          </label>
        </div>
        <div className="explorer-body">
          <FileTree nodes={tree} expanded={expanded} activePath={selected} onToggleDir={toggleDirectory} onOpenFile={selectFile}
            renderFileMeta={path => {
              const file = stats.get(path);
              return file ? <ChangeStats added={file.added} removed={file.removed} /> : null;
            }} />
          {files.length === 0 ? <div className="explorer-empty">{tr("没有匹配的文件", "No matching files")}</div> : null}
        </div>
      </nav>
    </div>
  </div>;
}
