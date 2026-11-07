import type {
  BranchSummary,
  ExecutionEnvironment,
  GitChangeScope,
  GitDiffOptions,
  GitStatusSnapshot,
  PullRequestInfo,
  SandboxApprovalRequest,
  SandboxMode,
  SelectableEnvironmentKind,
  VelaApi,
  WorkspaceState,
  WorkspaceUpdateInput,
} from "@vela/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { tr } from "../locale";
import { noSound, type NotifySound } from "../notification-sounds";
import { readGitHint, readSandboxHint, writeGitHint, writeSandboxHint } from "../startup-hint";

export type ProjectApi = ReturnType<typeof useProject>;

function getApi(): VelaApi {
  const api = window.vela;
  if (!api) throw new Error(tr("Vela API 不可用", "Vela API is unavailable"));
  return api;
}

/** Electron 把 IPC 错误包装成 "Error invoking remote method 'channel': Error: 原始消息",只展示可读部分。 */
export function cleanErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : "";
  const readable = raw
    .replace(/^Error invoking remote method '[^']+':\s*/i, "")
    .replace(/^Error:\s*/i, "")
    .trim();
  return readable || "操作失败";
}

/**
 * 聚合工作区 / 执行环境 / Git / Pull Request / Sandbox 权限的前端状态。
 * 状态更新全部由主进程推送事件驱动(workspace:event、git:event),
 * 组件只负责展示与发起动作。
 */
export function useProject(notify: NotifySound = noSound) {
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null);
  const [environment, setEnvironmentState] = useState<ExecutionEnvironment | null>(null);
  const [environments, setEnvironments] = useState<ExecutionEnvironment[]>([]);
  const [git, setGit] = useState<GitStatusSnapshot | null>(null);
  // 冷启动时主进程还没查完 Git,先用上次的快照占位;真实快照到达或工作区切换后即丢弃。
  const [gitHint, setGitHint] = useState(readGitHint);
  const [branches, setBranches] = useState<BranchSummary[]>([]);
  const [pr, setPr] = useState<PullRequestInfo | null>(null);
  const [sandboxMode, setSandboxModeState] = useState<SandboxMode>(() => readSandboxHint() ?? "ask");
  const [approval, setApproval] = useState<SandboxApprovalRequest | null>(null);
  const [error, setError] = useState<string | null>(null);

  const branchRef = useRef<string | null>(null);
  const approvalRef = useRef<SandboxApprovalRequest | null>(null);
  approvalRef.current = approval;

  const loadGit = useCallback(async (withBranchDeps: boolean) => {
    if (!window.vela) return;
    const snapshot = await window.vela.getGitStatus().catch(() => null);
    setGit(snapshot);
    const branchChanged = (snapshot?.branch ?? null) !== branchRef.current;
    branchRef.current = snapshot?.branch ?? null;
    if (withBranchDeps || branchChanged) {
      setBranches(await window.vela.listBranches().catch(() => []));
      setPr(await window.vela.getPullRequest().catch(() => null));
    }
  }, []);

  const guarded = useCallback(async (action: () => Promise<unknown>): Promise<boolean> => {
    try {
      await action();
      setError(null);
      return true;
    } catch (caught) {
      setError(cleanErrorMessage(caught));
      return false;
    }
  }, []);

  useEffect(() => {
    const api = window.vela;
    if (!api) return;
    let active = true;

    void (async () => {
      // 工作区只读本地记录,很快就返回;Git / 分支 / PR 要跑子进程或联网,可能慢得多。
      // 工作区单独先落地,避免启动时先显示空工作区、等 Git 查完才跳到上次的工作区。
      const workspaceRequest = api.getWorkspaceState().catch(() => null);
      void workspaceRequest.then((value) => {
        if (active && value) setWorkspace(value);
      });
      // 执行权限同样只读本地设置,单独先落地,不必等 Git / 分支 / PR。
      void api.getSandboxMode().then((value) => {
        if (active) setSandboxModeState(value);
      }).catch(() => undefined);
      const [nextWorkspace, nextEnv, nextEnvs, nextGit, nextBranches, nextPr] = await Promise.all([
        workspaceRequest,
        api.getEnvironment().catch(() => null),
        api.listEnvironments().catch(() => [] as ExecutionEnvironment[]),
        api.getGitStatus().catch(() => null),
        api.listBranches().catch(() => [] as BranchSummary[]),
        api.getPullRequest().catch(() => null),
      ]);
      if (!active) return;
      setWorkspace(nextWorkspace);
      setEnvironmentState(nextEnv);
      setEnvironments(nextEnvs);
      setGit(nextGit);
      branchRef.current = nextGit?.branch ?? null;
      setBranches(nextBranches);
      setPr(nextPr);
    })();

    const offWorkspace = api.onWorkspaceEvent((event) => {
      setGitHint(null);
      setWorkspace(event.workspace);
      setEnvironmentState(event.environment);
      void api
        .listEnvironments()
        .then((list) => {
          if (active) setEnvironments(list);
        })
        .catch(() => undefined);
      branchRef.current = null;
      void loadGit(true);
    });
    const offGit = api.onGitEvent(() => {
      void loadGit(false);
    });
    const offApproval = api.onApprovalEvent((event) => {
      if (event.type === "request") {
        notifyRef.current("permission");
        setApproval(event.request);
      } else if (approvalRef.current?.id === event.id) {
        setApproval(null);
      }
    });

    return () => {
      active = false;
      offWorkspace();
      offGit();
      offApproval();
    };
  }, [loadGit]);

  useEffect(() => {
    writeSandboxHint(sandboxMode);
  }, [sandboxMode]);

  const currentWorkspace = workspace?.current ?? null;
  useEffect(() => {
    if (!git || !currentWorkspace) return;
    setGitHint(null);
    // Git 事件频繁(文件监听),合并写盘。
    const timer = setTimeout(() => writeGitHint(currentWorkspace, git), 800);
    return () => clearTimeout(timer);
  }, [git, currentWorkspace]);
  const shownGit = git ?? (gitHint && gitHint.workspace === currentWorkspace ? gitHint.snapshot : null);

  const openWorkspaceDialog = useCallback(
    () => guarded(() => getApi().openWorkspaceDialog()),
    [guarded],
  );
  const selectRecentWorkspace = useCallback(
    (path: string) => guarded(() => getApi().selectWorkspace(path)),
    [guarded],
  );
  const closeWorkspace = useCallback(() => guarded(() => getApi().closeWorkspace()), [guarded]);
  const removeRecentWorkspace = useCallback(
    (path: string) => guarded(() => getApi().removeRecentWorkspace(path)),
    [guarded],
  );
  const pickWorkspaceFolder = useCallback(() => getApi().pickWorkspaceFolder(), []);
  const updateWorkspace = useCallback(
    (input: WorkspaceUpdateInput) => getApi().updateWorkspace(input),
    [],
  );

  const switchBranch = useCallback(
    (name: string) =>
      guarded(async () => {
        await getApi().switchBranch(name);
        await loadGit(true);
      }),
    [guarded, loadGit],
  );
  const createBranch = useCallback(
    (name: string) =>
      guarded(async () => {
        await getApi().createBranch(name);
        await loadGit(true);
      }),
    [guarded, loadGit],
  );
  const stageFiles = useCallback(
    (paths: string[]) =>
      guarded(async () => {
        await getApi().stageFiles(paths);
        await loadGit(false);
      }),
    [guarded, loadGit],
  );
  const unstageFiles = useCallback(
    (paths: string[]) =>
      guarded(async () => {
        await getApi().unstageFiles(paths);
        await loadGit(false);
      }),
    [guarded, loadGit],
  );
  const discardFiles = useCallback(
    (paths: string[], options?: { untracked?: boolean }) =>
      guarded(async () => {
        await getApi().discardFiles(paths, options);
        await loadGit(false);
      }),
    [guarded, loadGit],
  );
  const openFile = useCallback(
    (absolutePath: string) => guarded(() => getApi().openFile(absolutePath)),
    [guarded],
  );
  const fileDiff = useCallback(
    (path: string, scope: GitChangeScope, options?: GitDiffOptions) =>
      getApi().getFileDiff(path, scope, options),
    [],
  );
  /** 分支重命名/删除或远程变化后重新读取分支列表。 */
  const refreshBranches = useCallback(async () => {
    if (!window.vela) return;
    setBranches(await window.vela.listBranches().catch(() => []));
  }, []);

  const refreshPullRequest = useCallback(
    () => guarded(async () => setPr(await getApi().getPullRequest())),
    [guarded],
  );
  const openPullRequest = useCallback(
    (url: string) => guarded(() => getApi().openPullRequest(url)),
    [guarded],
  );
  const createPullRequest = useCallback(() => guarded(() => getApi().createPullRequest()), [guarded]);

  const setSandboxMode = useCallback(
    (mode: SandboxMode) =>
      guarded(async () => setSandboxModeState(await getApi().setSandboxMode(mode))),
    [guarded],
  );
  const setEnvironment = useCallback(
    (kind: SelectableEnvironmentKind) =>
      guarded(async () => {
        setEnvironmentState(await getApi().setEnvironment(kind));
        setEnvironments(await getApi().listEnvironments());
      }),
    [guarded],
  );
  const replyApproval = useCallback(
    (id: string, allowed: boolean) => getApi().replyApproval(id, allowed),
    [],
  );
  const clearError = useCallback(() => setError(null), []);

  return {
    workspace,
    environment,
    environments,
    git: shownGit,
    branches,
    pr,
    sandboxMode,
    approval,
    error,
    clearError,
    openWorkspaceDialog,
    selectRecentWorkspace,
    closeWorkspace,
    removeRecentWorkspace,
    pickWorkspaceFolder,
    updateWorkspace,
    switchBranch,
    createBranch,
    stageFiles,
    unstageFiles,
    discardFiles,
    openFile,
    fileDiff,
    refreshBranches,
    refreshPullRequest,
    openPullRequest,
    createPullRequest,
    setSandboxMode,
    setEnvironment,
    replyApproval,
  };
}
