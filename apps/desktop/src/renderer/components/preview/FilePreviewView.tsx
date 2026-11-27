import { useEffect, useMemo, useState } from "react";
import type { ProjectApi } from "../../hooks/useProject";
import { CodePane } from "./CodePane";
import { ExplorerPane } from "./ExplorerPane";
import { tr } from "../../locale";
import { useFilePreview, isAbsolutePathLike } from "./FilePreviewContext";
import { MarkdownPane } from "./MarkdownPane";
import { isMarkdownPath } from "./markdown-path";
import { PreviewBreadcrumbs } from "./PreviewBreadcrumbs";
import { PreviewHeader } from "./PreviewHeader";
import { Icon } from "../icons";

export function FilePreviewView({
  project,
  onShowDiff,
  commentConversationId,
  onCommentAdded,
}: {
  project: ProjectApi;
  onShowDiff: (path: string) => void;
  commentConversationId?: string | null;
  onCommentAdded?: () => void;
}) {
  const preview = useFilePreview();
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [viewMode, setViewMode] = useState<"preview" | "source">("preview");
  const tab = preview?.activeTab ?? null;
  const content = preview?.activeContent ?? null;
  const git = project.git;

  useEffect(() => {
    if (tab?.jumpLine != null) setViewMode("source");
  }, [tab?.id, tab?.jumpLine]);

  const changedPaths = useMemo(
    () => new Set((git?.files ?? []).map((file) => file.path)),
    [git],
  );

  if (!preview || !tab) return null;

  const rootName = git?.repo?.name ?? basename(preview.fileList?.root) ?? tr("工作区", "Workspace");
  // 工作区外的标签 id 是绝对路径,面包屑不再挂工作区根名。
  const absoluteTab = isAbsolutePathLike(tab.id);
  const canShowDiff = Boolean(git?.repo) && changedPaths.has(tab.id);
  const crumbs = [...(absoluteTab ? [] : [rootName]), ...(tab.dir ? tab.dir.split("/") : [])];
  const markdownBody = isMarkdownPath(tab.id) && content?.kind === "text" && Boolean(content.content);
  const htmlUrl = content?.htmlPreviewUrl;
  const canRender = markdownBody || Boolean(htmlUrl);
  const showRendered = canRender && viewMode === "preview" && tab.jumpLine == null;

  return (
    <div className="panel-file-preview-view">
      <PreviewHeader>
        <PreviewBreadcrumbs
          crumbs={crumbs}
          current={tab.name}
          iconPath={tab.id}
          title={tab.id}
          ariaLabel={tr("文件路径", "File path")}
        />
        <div className="preview-actions-group">
          {canRender ? (
            <div className="preview-view-toggle" role="group"
              aria-label={htmlUrl ? tr("HTML 显示方式", "HTML view mode") : tr("Markdown 显示方式", "Markdown view mode")}>
              <button
                type="button"
                aria-pressed={showRendered}
                className={showRendered ? "active" : ""}
                onClick={() => setViewMode("preview")}
              >
                {tr("预览", "Preview")}
              </button>
              <button
                type="button"
                aria-pressed={!showRendered}
                className={showRendered ? "" : "active"}
                onClick={() => setViewMode("source")}
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
              <Icon name="diff" size={12} />
              {tr("差异", "Diff")}
            </button>
          ) : null}
          {canRender || canShowDiff ? <span className="preview-actions-sep" aria-hidden="true" /> : null}
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
            <Icon name="external" size={14} />
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
            <Icon name="panel-right" size={14} />
          </button>
        </div>
      </PreviewHeader>

      <div className={`preview-main-split${explorerOpen ? "" : " explorer-hidden"}`}>
        {showRendered && htmlUrl ? (
          <iframe key={htmlUrl} className="preview-html-frame" title={`${tr("文件预览", "File preview")}: ${tab.name}`}
            sandbox="allow-scripts" referrerPolicy="no-referrer" src={htmlUrl} />
        ) : showRendered && content?.content ? (
          <MarkdownPane
            text={content.content}
            documentPath={tab.id}
            truncated={content.truncated}
            revision={preview.revision}
          />
        ) : (
          <CodePane onOpenExternal={(absolutePath) => project.openFile(absolutePath)}
            commentConversationId={commentConversationId} onCommentAdded={onCommentAdded} />
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
