import type { GitCommitSummary } from "@vela/shared";
import { useEffect, useMemo, useState } from "react";
import type { ProjectApi } from "../hooks/useProject";
import type { MessageStore } from "../hooks/message-store";
import { useMessages } from "../hooks/useMessages";
import { tr } from "../locale";
import { useFilePreview } from "./preview/FilePreviewContext";
import type { TurnChanges } from "./turn-changes";
import { TurnReviewView } from "./TurnReviewView";
import { ChangesFilter } from "./ChangesFilter";
import { emptyChanges, historicalChanges, lastTurnChanges, loadWorkspaceChanges, type ChangesCategory } from "./workspace-changes";

/** 工作区、对话轮次、提交及分支共用同一审查页。所有筛选均为只读。 */
export function WorkspaceChangesView({
  project, onClose, initialPath = null, initialPathRequestKey = 0, visible = true,
  messageStore, conversationId = null, streaming = false,
}: {
  project: ProjectApi;
  onClose: () => void;
  initialPath?: string | null;
  initialPathRequestKey?: number;
  visible?: boolean;
  messageStore?: MessageStore;
  conversationId?: string | null;
  streaming?: boolean;
}) {
  const git = project.git;
  const root = git?.repo?.root ?? null;
  const [selection, setSelection] = useState<{ category: ChangesCategory; ref?: string }>({ category: "uncommitted" });
  const { category } = selection;
  const messages = useMessages(messageStore, conversationId);
  const turn = useMemo(() => lastTurnChanges(messages, streaming, root), [messages, streaming, root]);
  const previewRevision = useFilePreview()?.revision ?? 0;
  const [historyRequested, setHistoryRequested] = useState(false);
  const [commitsState, setCommitsState] = useState<{ root: string | null; commits: GitCommitSummary[]; loading: boolean; error: boolean }>({ root: null, commits: [], loading: true, error: false });
  const [result, setResult] = useState<{ key: string; changes: TurnChanges; error?: boolean; truncated?: boolean } | null>(null);
  // Git 事件即使状态统计相同也可能包含新的 HEAD 或磁盘内容。
  const [revision, setRevision] = useState(0);
  useEffect(() => { setRevision(value => value + 1); }, [git]);
  useEffect(() => { setSelection({ category: "uncommitted" }); setHistoryRequested(false); }, [root]);
  // 从文件预览跳入差异时必须离开历史/分类视图,以保证目标文件可见。
  useEffect(() => { if (initialPath) setSelection({ category: "uncommitted" }); }, [initialPath, initialPathRequestKey]);

  useEffect(() => {
    if (!root || !visible || !historyRequested || !window.vela) return;
    let active = true;
    setCommitsState(current => ({ root, commits: current.root === root ? current.commits : [], loading: true, error: false }));
    void window.vela.getCommitGraph({ scope: "current", limit: 100, skip: 0 }).then(graph => {
      if (active) setCommitsState({ root, commits: graph.commits, loading: false, error: false });
    }).catch(() => { if (active) setCommitsState({ root, commits: [], loading: false, error: true }); });
    return () => { active = false; };
  }, [root, git?.branch, revision, visible, historyRequested]);

  const commits = commitsState.root === root ? commitsState.commits : [];
  const branches = (project.branches ?? []).filter(branch => !branch.current);
  const commitSha = category === "committed" ? selection.ref ?? commits[0]?.sha ?? null : null;
  const baseBranch = category === "branch" ? selection.ref ?? branches[0]?.name ?? null : null;
  const key = JSON.stringify([root, category, selection.ref]);
  useEffect(() => {
    if (!root || !visible || category === "last-turn") return;
    let active = true;
    const load = async () => {
      if (category === "committed") {
        if (!commitSha) return { changes: emptyChanges };
        const detail = await window.vela!.getCommitDetail(commitSha);
        return { changes: historicalChanges(detail.files, detail.diff), truncated: detail.diffTruncated };
      }
      if (category === "branch") {
        if (!baseBranch) return { changes: emptyChanges };
        const comparison = await window.vela!.compareRefs(baseBranch, "HEAD");
        if (comparison.error) throw new Error(comparison.error);
        return { changes: historicalChanges(comparison.files, comparison.diff), truncated: comparison.diffTruncated };
      }
      return { changes: await loadWorkspaceChanges(git?.files ?? [], category, project.fileDiff) };
    };
    void load().then(next => {
      if (active) setResult(previous => ({ key, ...next,
        changes: previous?.key === key && JSON.stringify(previous.changes) === JSON.stringify(next.changes) ? previous.changes : next.changes,
      }));
    }).catch(() => { if (active) setResult({ key, changes: emptyChanges, error: true }); });
    return () => { active = false; };
  }, [key, root, visible, commitSha, baseBranch, project.fileDiff, revision, previewRevision]);

  const current = result?.key === key ? result : null;
  const changes = category === "last-turn" ? turn : current?.changes ?? emptyChanges;
  const review = useMemo(() => ({ turnId: `workspace-changes:${root}:${category}:${selection.ref ?? ""}:${category === "last-turn" ? conversationId : ""}`, changes }), [root, category, selection.ref, conversationId, changes]);
  const target = useMemo(() => initialPath ? { path: initialPath, requestKey: initialPathRequestKey } : undefined, [initialPath, initialPathRequestKey]);
  const emptyLabel = category === "last-turn" ? tr("没有上一轮变更", "No changes in the last turn")
    : category === "staged" ? tr("没有已暂存的变更", "No staged changes")
    : category === "unstaged" ? tr("没有未暂存的变更", "No unstaged changes")
    : category === "committed" ? tr("没有提交记录", "No commits yet")
    : category === "branch" ? tr("分支没有差异", "No branch differences") : tr("工作区是干净的", "Workspace is clean");
  const status = category !== "last-turn" && !current ? tr("正在读取差异…", "Reading diff…")
    : current?.error ? tr("加载变更失败", "Failed to load changes") : null;
  if (!git?.repo) return null;
  return <TurnReviewView review={review} visible={visible} onClose={onClose}
    target={category === "uncommitted" ? target : undefined}
    filesLabel={tr("变更文件", "Changed files")} emptyLabel={emptyLabel}
    statusLabel={status ? <>{status}{current?.error ? <button type="button" className="changes-filter-retry"
      onClick={() => setRevision(value => value + 1)}>{tr("重试", "Retry")}</button> : null}</> : null}
    noticeLabel={current?.truncated ? tr("差异过大，仅显示部分内容", "Diff is too large; only part is shown") : undefined}
    toolbarControl={<ChangesFilter category={category} onSelect={(next, ref) => setSelection({ category: next, ref })}
      onRequestCommits={() => { setHistoryRequested(true); if (commitsState.error) setRevision(value => value + 1); }}
      commits={commits} commitsLoading={commitsState.loading} commitsError={commitsState.error}
      branches={branches} commitSha={commitSha} baseBranch={baseBranch} visible={visible} />} />;
}
