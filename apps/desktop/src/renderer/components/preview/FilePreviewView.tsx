import { useEffect, useMemo, useState } from "react";
import type { ProjectApi } from "../../hooks/useProject";
import { CheckIcon, ChevronRightIcon, CopyIcon, DiffIcon, ExternalIcon, PanelRightIcon, RefreshIcon } from "../icons";
import { FileTypeIcon } from "../FileTypeIcon";
import { CodePane } from "./CodePane";
import { ExplorerPane } from "./ExplorerPane";
import { tr } from "../../locale";
import { useFilePreview, isAbsolutePathLike } from "./FilePreviewContext";
import { MarkdownPane } from "./MarkdownPane";
import { isMarkdownPath } from "./markdown-path";

export function FilePreviewView({
  project,
  onShowDiff,
}: {
  project: ProjectApi;
  onShowDiff: (path: string) => void;
}) {
  const preview = useFilePreview();
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [markdownMode, setMarkdownMode] = useState<"preview" | "source">("preview");
  const [copied, setCopied] = useState(false);
  const tab = preview?.activeTab ?? null;
  const content = preview?.activeContent ?? null;
  const git = project.git;

  useEffect(() => {
    if (tab?.jumpLine != null) setMarkdownMode("source");
  }, [tab?.id, tab?.jumpLine]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const changedPaths = useMemo(
    () => new Set((git?.files ?? []).map((file) => file.path)),
    [git],
  );

  if (!preview || !tab) return null;

  const rootName = git?.repo?.name ?? basename(preview.fileList?.root) ?? tr("工作区", "Workspace");
  // 工作区外的标签 id 是绝对路径,面包屑不再挂工作区根名。
  const absoluteTab = isAbsolutePathLike(tab.id);
  const canCopy = content?.kind === "text" && Boolean(content.content);
  const canShowDiff = Boolean(git?.repo) && changedPaths.has(tab.id);
  const crumbs = [...(absoluteTab ? [] : [rootName]), ...(tab.dir ? tab.dir.split("/") : [])];
  const markdownBody = isMarkdownPath(tab.id) && content?.kind === "text" && Boolean(content.content);
  const showRendered = markdownBody && markdownMode === "preview" && tab.jumpLine == null;

  return (
    <div className="panel-file-preview-view">
      <div className="preview-subbar">
        <nav className="preview-breadcrumbs-text" title={tab.id} aria-label={tr("文件路径", "File path")}>
          {crumbs.map((segment, index) => (
            <span className="preview-crumb" key={`${index}:${segment}`}>
              {index > 0 ? <ChevronRightIcon size={10} /> : null}
              <span className="preview-crumb-text">{segment}</span>
            </span>
          ))}
          <span className="preview-crumb current">
            {crumbs.length > 0 ? <ChevronRightIcon size={10} /> : null}
            <FileTypeIcon path={tab.id} />
            <strong>{tab.name}</strong>
          </span>
        </nav>
        <div className="preview-actions-group">
          {markdownBody ? (
            <div className="preview-view-toggle" role="group" aria-label={tr("Markdown 显示方式", "Markdown view mode")}>
              <button
                type="button"
                aria-pressed={showRendered}
                className={showRendered ? "active" : ""}
                onClick={() => setMarkdownMode("preview")}
              >
                {tr("预览", "Preview")}
              </button>
              <button
                type="button"
                aria-pressed={!showRendered}
                className={showRendered ? "" : "active"}
                onClick={() => setMarkdownMode("source")}
              >
                {tr("源码", "Source")}
              </button>
            </div>
          ) : null}
          {canShowDiff ? (
            <button
              type="button"
              className="preview-action-pill"
              title={tr("查看该文件的 Git 差异", "View this file's Git diff")}
              onClick={() => onShowDiff(tab.id)}
            >
              <DiffIcon size={12} />
              {tr("差异", "Diff")}
            </button>
          ) : null}
          <span className="preview-actions-sep" aria-hidden="true" />
          <button
            type="button"
            className="icon-btn-ghost"
            title={tr("重新读取", "Reload")}
            aria-label={tr("重新读取", "Reload")}
            onClick={preview.reloadActive}
          >
            <RefreshIcon size={13} />
          </button>
          <button
            type="button"
            className="icon-btn-ghost"
            title={copied ? tr("已复制", "Copied") : tr("复制文件内容", "Copy file contents")}
            aria-label={copied ? tr("已复制", "Copied") : tr("复制文件内容", "Copy file contents")}
            disabled={!canCopy}
            onClick={() => {
              if (!content?.content) return;
              void navigator.clipboard.writeText(content.content).then(() => setCopied(true));
            }}
          >
            {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
          </button>
          <button
            type="button"
            className="icon-btn-ghost"
            title={tr("用默认应用打开", "Open with default app")}
            aria-label={tr("用默认应用打开", "Open with default app")}
            disabled={!content}
            onClick={() => {
              if (content) project.openFile(content.absolutePath);
            }}
          >
            <ExternalIcon size={13} />
          </button>
          <span className="preview-actions-sep" aria-hidden="true" />
          <button
            type="button"
            className={`icon-btn-ghost${explorerOpen ? " on" : ""}`}
            title={explorerOpen ? tr("收起文件树", "Hide file tree") : tr("展开文件树", "Show file tree")}
            aria-label={tr("文件树", "File tree")}
            aria-pressed={explorerOpen}
            onClick={() => setExplorerOpen((value) => !value)}
          >
            <PanelRightIcon size={14} />
          </button>
        </div>
      </div>

      <div className={`preview-main-split${explorerOpen ? "" : " explorer-hidden"}`}>
        {showRendered && content?.content ? (
          <MarkdownPane
            text={content.content}
            documentPath={tab.id}
            truncated={content.truncated}
            revision={preview.revision}
          />
        ) : (
          <CodePane onOpenExternal={(absolutePath) => project.openFile(absolutePath)} />
        )}
        {explorerOpen ? <ExplorerPane /> : null}
      </div>
    </div>
  );
}

function basename(path: string | null | undefined): string | null {
  if (!path) return null;
  const parts = path.split("/").filter(Boolean);
  return parts.pop() ?? null;
}
