import type { GitFileChange } from "@vela/shared";
import { useEffect, useMemo, useState } from "react";
import type { ProjectApi } from "../hooks/useProject";
import { tr } from "../locale";
import { useFilePreview } from "./preview/FilePreviewContext";
import type { TurnChanges, TurnFileChange } from "./turn-changes";
import { TurnReviewView } from "./TurnReviewView";

const WORKSPACE_REVIEW_ID = "workspace-changes";
const DIFF_CONCURRENCY = 4;

function fileSignature(file: GitFileChange): string {
  return [file.path, file.status, file.indexStatus, file.worktreeStatus, file.addedLines, file.deletedLines].join("\0");
}

/** 与旧版快速面板一致:同一文件同时有索引和工作区改动时展示工作区改动。 */
async function loadChanges(files: GitFileChange[], fileDiff: ProjectApi["fileDiff"]): Promise<TurnChanges> {
  const loaded: TurnFileChange[] = new Array(files.length);
  let next = 0;
  const worker = async () => {
    while (next < files.length) {
      const index = next++;
      const file = files[index];
      const worktree = file.worktreeStatus !== null;
      const diff = await fileDiff(file.path, worktree ? "worktree" : "index").catch(() => "");
      loaded[index] = {
        path: file.path,
        added: worktree ? file.worktreeAddedLines : file.indexAddedLines,
        removed: worktree ? file.worktreeDeletedLines : file.indexDeletedLines,
        diffs: [diff],
        format: "unified",
      };
    }
  };
  await Promise.all(Array.from({ length: Math.min(DIFF_CONCURRENCY, files.length) }, worker));
  return {
    files: loaded,
    added: loaded.reduce((sum, file) => sum + file.added, 0),
    removed: loaded.reduce((sum, file) => sum + file.removed, 0),
  };
}

/** 工作区未提交的 Git 变更,用与「变更审查」相同的页面展示。 */
export function WorkspaceChangesView({
  project,
  onClose,
  initialPath = null,
  initialPathRequestKey = 0,
  visible = true,
}: {
  project: ProjectApi;
  onClose: () => void;
  /** 外部(如文件预览)请求定位的文件路径。 */
  initialPath?: string | null;
  /** 同一路径重复请求时也重新定位。 */
  initialPathRequestKey?: number;
  visible?: boolean;
}) {
  const git = project.git;
  const files = git?.files;
  const fileDiff = project.fileDiff;
  const previewRevision = useFilePreview()?.revision ?? 0;
  const [changes, setChanges] = useState<TurnChanges | null>(null);
  const signature = useMemo(() => (files ?? []).map(fileSignature).join("\n"), [files]);

  useEffect(() => {
    if (!files) return;
    if (files.length === 0) {
      setChanges(current => current && current.files.length === 0 ? current : { files: [], added: 0, removed: 0 });
      return;
    }
    let active = true;
    void loadChanges(files, fileDiff).then(next => {
      // 内容没变就保留原对象,审查页不会因此重排或回到顶部。
      if (active) setChanges(current => current && JSON.stringify(current) === JSON.stringify(next) ? current : next);
    });
    return () => { active = false; };
    // files 的内容由 signature 代表;previewRevision 变化表示磁盘文件已变。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, fileDiff, previewRevision]);

  const review = useMemo(() => changes ? { turnId: WORKSPACE_REVIEW_ID, changes } : null, [changes]);
  const target = useMemo(
    () => initialPath ? { path: initialPath, requestKey: initialPathRequestKey } : undefined,
    [initialPath, initialPathRequestKey],
  );

  if (!git?.repo) return null;
  if (!review) {
    return <div className="turn-review-view"><div className="turn-review-empty">{tr("正在读取差异…", "Reading diff…")}</div></div>;
  }
  return <TurnReviewView review={review} visible={visible} onClose={onClose} target={target}
    title={tr("工作区变更", "Workspace changes")} filesLabel={tr("工作区变更文件", "Files changed in the workspace")}
    emptyLabel={tr("工作区是干净的", "Workspace is clean")} />;
}
