import type { WorkspaceFileContent, WorkspaceFileList, WorkspaceSearchResult } from "@vela/shared";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { PreviewFileDescriptor } from "./file-tab-persistence";
export type { PreviewFileDescriptor } from "./file-tab-persistence";

export interface PreviewTab {
  /** 规范化路径(工作区内为相对路径,工作区外为绝对路径),作为标签唯一标识 */
  id: string;
  name: string;
  dir: string;
  /** 请求跳转的行号(代码搜索/引用跳转),消费后置回 null */
  jumpLine: number | null;
}

export interface FilePreviewContextValue {
  open: boolean;
  tabs: PreviewTab[];
  activeTab: PreviewTab | null;
  activeContent: WorkspaceFileContent | null;
  contentLoading: boolean;
  contentError: string | null;
  /** 内容版本号:git 变更后自增,触发重新读取 */
  revision: number;
  fileList: WorkspaceFileList | null;
  fileSet: Set<string> | null;
  openFile(path: string, options?: { line?: number }): void;
  closeTab(id: string): void;
  setActiveTab(id: string): void;
  closePreview(): void;
  consumeJump(id?: string): void;
  setTabScroll(id: string, scrollTop: number): void;
  getTabScroll(id: string): number;
  ensureFileList(): void;
  searchCode(query: string): Promise<WorkspaceSearchResult>;
  /** 把聊天里的内联文本解析成工作区文件路径;不唯一或不存在时返回 null。 */
  resolveFilePath(text: string): string | null;
}

function createScope() {
  return {
    mounted: false,
    blocked: false,
    generation: 0,
    fileListRequested: false,
    tabs: [] as PreviewTab[],
    contentCache: new Map<string, WorkspaceFileContent>(),
    scrollPositions: new Map<string, number>(),
  };
}

type PreviewScope = ReturnType<typeof createScope>;
const FilePreviewContext = createContext<(FilePreviewContextValue & { scope: PreviewScope }) | null>(null);

export function useFilePreview(): FilePreviewContextValue | null {
  return useContext(FilePreviewContext);
}

/** 识别 / 或盘符开头的绝对路径,与主进程 isAbsolute 的判断保持一致。 */
export function isAbsolutePathLike(path: string): boolean {
  return path.startsWith("/") || /^[a-zA-Z]:\//.test(path);
}

/** 两次读取结果一致时沿用旧对象身份,让 React 跳过重渲染,避免无关的 git 事件引起预览闪动。 */
function sameFileContent(current: WorkspaceFileContent | null, next: WorkspaceFileContent): boolean {
  return (
    current !== null &&
    current.path === next.path &&
    current.absolutePath === next.absolutePath &&
    current.kind === next.kind &&
    current.content === next.content &&
    current.htmlPreviewUrl === next.htmlPreviewUrl &&
    current.size === next.size &&
    current.truncated === next.truncated
  );
}

function splitTabPath(path: string): { id: string; name: string; dir: string } {
  const segments = path.split("/").filter(Boolean);
  const name = segments.pop() ?? path;
  return { id: segments.length > 0 ? `${segments.join("/")}/${name}` : name, name, dir: segments.join("/") };
}

/** 把任意输入路径收成标签 id:工作区内归一为相对路径,工作区外保留绝对路径。 */
export function normalizeTabPath(
  rawPath: string,
  workspaceRoot: string | null,
): { id: string; name: string; dir: string } {
  const normalized = rawPath.trim().replaceAll("\\", "/").replace(/^\.\//, "");
  if (!isAbsolutePathLike(normalized)) return splitTabPath(normalized);
  // 工作区内的绝对路径归一为相对路径,与文件树/搜索打开的标签共用一个 id。
  const root = workspaceRoot ? workspaceRoot.replaceAll("\\", "/").replace(/\/+$/, "") : null;
  if (root && root !== "/" && normalized.toLowerCase().startsWith(`${root.toLowerCase()}/`)) {
    return splitTabPath(normalized.slice(root.length + 1));
  }
  // 工作区外的绝对路径保留原样,交给主进程判定并返回 outside-root。
  const segments = normalized.split("/").filter(Boolean);
  const name = segments.pop() ?? normalized;
  return { id: normalized, name, dir: segments.join("/") };
}

/**
 * 文件预览的多标签状态:标签、内容缓存、工作区文件列表与代码搜索。
 * 打开文件会通知宿主激活对应标签;git 变更时自动重读激活文件。
 */
export function FilePreviewProvider({
  children,
  workspaceKey,
  workspaceTabs,
  onOpenFile,
  onCloseFileTab,
  onCloseAllFileTabs,
  replaceTabId = null,
}: {
  children: ReactNode;
  /** The host's current workspace and its open descriptors. Hydration is silent. */
  workspaceKey?: string;
  workspaceTabs?: readonly PreviewFileDescriptor[];
  /** 文件打开或重新激活时通知宿主，并提供规范化路径身份。 */
  onOpenFile?: (file: PreviewFileDescriptor, replacedId?: string) => void;
  /** Only an active file preview may be replaced; existing targets are always activated. */
  replaceTabId?: string | null;
  /** 关闭单个文件标签时同步通知宿主。 */
  onCloseFileTab?: (id: string) => void;
  /** Only explicit close-all actions notify the host, not workspace transitions. */
  onCloseAllFileTabs?: (ids: string[]) => void;
}) {
  const [standaloneRevision, setStandaloneRevision] = useState(0);
  const scope = useMemo(createScope, [workspaceKey, standaloneRevision]);
  const [projection, setProjection] = useState({ scope, files: workspaceTabs });
  const [tabs, setTabs] = useState<PreviewTab[]>(() => (workspaceTabs ?? []).map(({ id, name, dir }) => ({ id, name, dir, jumpLine: null })));
  const [activeTabId, setActiveTabId] = useState<string | null>(() => workspaceTabs?.at(-1)?.id ?? null);
  const [revision, setRevision] = useState(0);
  const [fileList, setFileList] = useState<WorkspaceFileList | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);
  const [activeContent, setActiveContent] = useState<WorkspaceFileContent | null>(null);
  /** activeContent 归属的标签;与 activeTabId 不同时对外不可见,避免切换标签闪出上一个文件。 */
  const [contentTabId, setContentTabId] = useState<string | null>(null);
  const contentTabIdRef = useRef<string | null>(contentTabId);
  contentTabIdRef.current = contentTabId;

  // Reconcile before children render, without remounting the rest of the workbench.
  if (projection.scope !== scope || projection.files !== workspaceTabs) {
    const switched = projection.scope !== scope;
    const next = (workspaceTabs ?? []).map(({ id, name, dir }) => ({
      id, name, dir, jumpLine: scope.tabs.find(tab => tab.id === id)?.jumpLine ?? null,
    }));
    setProjection({ scope, files: workspaceTabs });
    setTabs(next);
    setActiveTabId(active => !switched && next.some(tab => tab.id === active) ? active : next.at(-1)?.id ?? null);
    if (switched) {
      setFileList(null);
      setContentTabId(null);
      setActiveContent(null);
      setContentError(null);
      setContentLoading(false);
    }
  }

  const replaceTabIdRef = useRef(replaceTabId);
  useLayoutEffect(() => {
    for (const tab of scope.tabs) {
      if (tabs.some(live => live.id === tab.id)) continue;
      scope.contentCache.delete(tab.id);
      scope.scrollPositions.delete(tab.id);
    }
    scope.tabs = tabs;
    replaceTabIdRef.current = replaceTabId;
  }, [scope, tabs, replaceTabId]);
  useLayoutEffect(() => {
    scope.mounted = true;
    return () => {
      scope.mounted = false;
      scope.fileListRequested = false;
      scope.generation += 1;
    };
  }, [scope]);

  const openFile = useCallback(
    (path: string, options?: { line?: number }) => {
      if (!path || !scope.mounted || scope.blocked) return;
      const normalized = normalizeTabPath(path, fileList?.root ?? (workspaceKey || null));
      if (!normalized.id) return;
      const current = scope.tabs;
      const existing = current.find((tab) => tab.id === normalized.id);
      const replacedId = !existing && current.some(tab => tab.id === replaceTabIdRef.current)
        ? replaceTabIdRef.current! : undefined;
      const nextTab = { ...normalized, jumpLine: options?.line ?? null };
      const next = existing
        ? options?.line != null && existing.jumpLine !== options.line
          ? current.map(tab => tab.id === normalized.id ? nextTab : tab) : current
        : replacedId ? current.map(tab => tab.id === replacedId ? nextTab : tab) : [...current, nextTab];
      scope.tabs = next;
      setTabs(next);
      if (replacedId) {
        scope.contentCache.delete(replacedId);
        scope.scrollPositions.delete(replacedId);
        replaceTabIdRef.current = normalized.id;
      }
      setActiveTabId(normalized.id);
      setContentError(null);
      onOpenFile?.({
        id: normalized.id,
        path: normalized.id,
        name: normalized.name,
        dir: normalized.dir,
      }, replacedId);
    },
    [fileList, workspaceKey, scope, onOpenFile],
  );

  const closeTab = useCallback((id: string) => {
    const index = scope.tabs.findIndex(tab => tab.id === id);
    if (index < 0) return;
    const next = scope.tabs.filter(tab => tab.id !== id);
    scope.tabs = next;
    scope.contentCache.delete(id);
    scope.scrollPositions.delete(id);
    // A workbench exit animation can complete after switching workspaces.
    // Still notify its original host callback, but do not change the new scope's view.
    if (scope.mounted) {
      setTabs(next);
      setActiveTabId(active => active === id ? next[Math.min(index, next.length - 1)]?.id ?? null : active);
    }
    onCloseFileTab?.(id);
  }, [scope, onCloseFileTab]);

  const setActiveTab = useCallback((id: string) => {
    if (scope.mounted && !scope.blocked && scope.tabs.some(tab => tab.id === id)) setActiveTabId(id);
  }, [scope]);

  const closePreview = useCallback(() => {
    const ids = scope.tabs.map(tab => tab.id);
    if (!ids.length) return;
    scope.tabs = [];
    scope.contentCache.clear();
    scope.scrollPositions.clear();
    if (scope.mounted) {
      setTabs([]);
      setActiveTabId(null);
    }
    onCloseAllFileTabs?.(ids);
  }, [scope, onCloseAllFileTabs]);

  const consumeJump = useCallback((id?: string) => {
    if (!scope.mounted || !scope.tabs.some(tab => tab.jumpLine != null && (id === undefined || tab.id === id))) return;
    scope.tabs = scope.tabs.map(tab => tab.jumpLine != null && (id === undefined || tab.id === id) ? { ...tab, jumpLine: null } : tab);
    setTabs(scope.tabs);
  }, [scope]);

  const setTabScroll = useCallback((id: string, scrollTop: number) => {
    scope.scrollPositions.set(id, scrollTop);
  }, [scope]);

  const getTabScroll = useCallback((id: string) => scope.scrollPositions.get(id) ?? 0, [scope]);

  const refreshFileList = useCallback(() => {
    if (!window.vela || !scope.mounted || scope.blocked) return;
    const generation = scope.generation;
    window.vela.listWorkspaceFiles().then(list => {
      if (scope.mounted && scope.generation === generation) setFileList(list);
    }).catch(() => undefined);
  }, [scope]);

  const ensureFileList = useCallback(() => {
    if (scope.fileListRequested || !scope.mounted || scope.blocked || !window.vela) return;
    scope.fileListRequested = true;
    refreshFileList();
  }, [scope, refreshFileList]);

  const searchCode = useCallback((query: string) => {
    const api = window.vela;
    if (!api || !scope.mounted || scope.blocked) return Promise.reject(new Error("Vela API 不可用"));
    const generation = scope.generation;
    return api.searchWorkspaceCode(query).then(result => {
      if (!scope.mounted || scope.generation !== generation) return { query, matches: [], truncated: false };
      return result;
    });
  }, [scope]);

  // 激活标签内容:命中缓存时在绘制前同步换上,切换回读过的标签不会闪一帧「读取中」。
  useLayoutEffect(() => {
    if (!activeTabId) {
      setActiveContent(null);
      setContentTabId(null);
      setContentError(null);
      setContentLoading(false);
      return;
    }
    const cached = scope.contentCache.get(activeTabId);
    if (!cached) return;
    setActiveContent(cached);
    setContentTabId(activeTabId);
    setContentError(null);
    setContentLoading(false);
  }, [activeTabId, revision, scope]);

  // 缓存未命中时经 IPC 读取。重读(git 变更、手动刷新)期间保留旧内容继续显示,读完原地替换,
  // 避免预览整块换成「读取中」导致滚动位置被浏览器夹回顶部。
  useEffect(() => {
    const api = window.vela;
    if (!api || !activeTabId || !scope.mounted || scope.blocked || scope.contentCache.has(activeTabId)) return;
    const generation = scope.generation;
    let active = true;
    const live = () => active && scope.mounted && scope.generation === generation && scope.tabs.some(tab => tab.id === activeTabId);
    setContentLoading(true);
    setContentError(null);
    api
      .readWorkspaceFile(activeTabId)
      .then((content) => {
        if (!live()) return;
        scope.contentCache.set(activeTabId, content);
        // 内容没变就沿用旧对象,React 直接跳过重渲染,预览不会因为无关的 git 事件闪动。
        setActiveContent((current) => (sameFileContent(current, content) ? current : content));
        setContentTabId(activeTabId);
      })
      .catch((error) => {
        if (!live()) return;
        setContentError(error instanceof Error ? error.message : "读取失败");
        // 同一标签重读失败保留旧内容;新标签失败清掉内容归属,让错误信息显示出来。
        setActiveContent((current) => (contentTabIdRef.current === activeTabId ? current : null));
        setContentTabId(activeTabId);
      })
      .finally(() => {
        if (live()) setContentLoading(false);
      });
    return () => {
      active = false;
    };
  }, [activeTabId, revision, scope]);

  useLayoutEffect(() => {
    const api = window.vela;
    if (!api) return;
    const offGit = api.onGitEvent(() => {
      if (!scope.mounted || scope.blocked || !scope.tabs.length) return;
      scope.contentCache.clear();
      setRevision(value => value + 1);
      refreshFileList();
    });
    const offWorkspace = api.onWorkspaceEvent(event => {
      if (!scope.mounted) return;
      if (workspaceKey === undefined) {
        scope.blocked = true;
        scope.generation += 1;
        setStandaloneRevision(value => value + 1);
        return;
      }
      // IPC switches roots before React commits the new workspace prop. Ignore late
      // results and do not start any more requests against the outgoing scope.
      const blocked = (event.workspace.current ?? "") !== workspaceKey;
      if (scope.blocked === blocked) return;
      scope.blocked = blocked;
      scope.generation += 1;
      scope.contentCache.clear();
      scope.scrollPositions.clear();
      scope.fileListRequested = false;
      setFileList(null);
      setActiveContent(null);
      setContentTabId(null);
      setContentError(null);
      setContentLoading(false);
      setRevision(value => value + 1);
    });
    return () => {
      offGit();
      offWorkspace();
    };
  }, [refreshFileList, scope, workspaceKey]);

  const fileSet = useMemo(() => (fileList ? new Set(fileList.files) : null), [fileList]);

  const basenameIndex = useMemo(() => {
    const index = new Map<string, string[]>();
    if (!fileList) return index;
    for (const path of fileList.files) {
      const name = path.split("/").pop() ?? path;
      const bucket = index.get(name);
      if (bucket) bucket.push(path);
      else index.set(name, [path]);
    }
    return index;
  }, [fileList]);

  const resolveFilePath = useCallback(
    (text: string): string | null => {
      if (!fileSet) return null;
      const candidate = text.trim().replaceAll("\\", "/");
      if (!candidate || candidate.includes("\0") || candidate.includes("..") || candidate.length > 300) {
        return null;
      }
      if (fileSet.has(candidate)) return candidate;
      // 目录后缀匹配:src/App.tsx → packages/app/src/App.tsx
      const suffixMatches = fileList!.files.filter((path) => path.endsWith(`/${candidate}`));
      if (suffixMatches.length === 1) return suffixMatches[0];
      if (!candidate.includes("/")) {
        const byName = basenameIndex.get(candidate);
        if (byName?.length === 1) return byName[0];
      }
      return null;
    },
    [fileSet, fileList, basenameIndex],
  );

  // 内容与加载态都按标签归属过滤:切到新标签时不会闪出上一个文件的内容或空状态。
  const visibleContent = activeTabId != null && contentTabId === activeTabId ? activeContent : null;
  const visibleLoading =
    activeTabId != null && visibleContent == null && (contentTabId !== activeTabId || contentLoading);

  const value = useMemo(
    () => ({
      scope,
      open: tabs.length > 0,
      tabs,
      activeTab: tabs.find((tab) => tab.id === activeTabId) ?? null,
      activeContent: visibleContent,
      contentLoading: visibleLoading,
      contentError,
      revision,
      fileList,
      fileSet,
      openFile,
      closeTab,
      setActiveTab,
      closePreview,
      consumeJump,
      setTabScroll,
      getTabScroll,
      ensureFileList,
      searchCode,
      resolveFilePath,
    }),
    [
      scope,
      tabs,
      activeTabId,
      visibleContent,
      visibleLoading,
      contentError,
      revision,
      fileList,
      fileSet,
      openFile,
      closeTab,
      setActiveTab,
      closePreview,
      consumeJump,
      setTabScroll,
      getTabScroll,
      ensureFileList,
      searchCode,
      resolveFilePath,
    ],
  );

  return <FilePreviewContext.Provider value={value}>{children}</FilePreviewContext.Provider>;
}

/** 每个文件标签独立读取与滚动；共享文件树、路径解析及宿主标签管理。 */
export function FilePreviewScope({ path, visible, children }: { path: string; visible: boolean; children: ReactNode }) {
  const parent = useContext(FilePreviewContext);
  const scope = parent?.scope;
  const activeTab = parent?.tabs.find(tab => tab.id === path) ?? null;
  const [cached, setCached] = useState<{ scope: PreviewScope; generation: number; path: string; revision: number; content: WorkspaceFileContent } | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState<{ scope: PreviewScope; generation: number; path: string; message: string } | null>(null);
  const sharedContent = parent?.activeTab?.id === path ? parent.activeContent : null;
  const revision = parent?.revision ?? 0;
  const generation = scope?.generation;
  const current = cached?.scope === scope && cached?.generation === generation && cached?.path === path ? cached : null;
  const error = failed?.scope === scope && failed?.generation === generation && failed?.path === path ? failed.message : null;
  const open = activeTab !== null;
  useEffect(() => {
    if (!visible || !open || !scope?.mounted || scope.blocked || current?.revision === revision || !window.vela) return;
    const observedGeneration = scope.generation;
    let active = true;
    const live = () => active && scope.mounted && scope.generation === observedGeneration;
    setLoading(true); setFailed(null);
    void window.vela.readWorkspaceFile(path).then(content => {
      if (live()) setCached({ scope, generation: observedGeneration, path, revision,
        content: sameFileContent(current?.content ?? null, content) ? current!.content : content });
    }).catch(reason => {
      if (live()) setFailed({ scope, generation: observedGeneration, path, message: reason instanceof Error ? reason.message : "读取失败" });
    }).finally(() => { if (live()) setLoading(false); });
    return () => { active = false; };
  }, [path, visible, revision, current, scope, open, generation]);
  if (!parent) return null;
  const value = {
    ...parent, activeTab,
    activeContent: open ? current?.content ?? sharedContent : null,
    contentLoading: open && (loading || (!current && !sharedContent && !error)),
    contentError: open ? error : null,
    consumeJump: () => parent.consumeJump(path),
  };
  return <FilePreviewContext.Provider value={value}>{children}</FilePreviewContext.Provider>;
}
