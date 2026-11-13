import { useEffect } from "react";
import { tr } from "../../locale";
import { ExplorerPane } from "./ExplorerPane";
import { useFilePreview } from "./FilePreviewContext";
import { PreviewBreadcrumbs } from "./PreviewBreadcrumbs";

/** The Files entry shows the tree until the first selected file takes over this tab. */
export function FileBrowserView() {
  const preview = useFilePreview();

  useEffect(() => {
    preview?.ensureFileList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rootName = basename(preview?.fileList?.root) ?? tr("工作区", "Workspace");

  return (
    <div className="panel-file-preview-view">
      <div className="preview-subbar">
        <PreviewBreadcrumbs crumbs={[rootName]} current={tr("文件", "Files")} />
      </div>
      <div className="preview-main-split">
        <div className="file-browser-empty" />
        <ExplorerPane />
      </div>
    </div>
  );
}

function basename(path: string | null | undefined): string | null {
  if (!path) return null;
  const parts = path.split("/").filter(Boolean);
  return parts.pop() ?? null;
}
