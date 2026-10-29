/**
 * 跨对话冲突提醒：同时开着几个任务时，记录每个对话近期用 edit / write 改过的文件，
 * 发现两个以上对话改了同一个文件就提醒，并可以把其中一个转到独立 worktree。
 * 只统计 edit / write 的成功调用；bash 和外部程序造成的改动无法归因到某个对话。
 */

export const conflictLimits = {
  /** 近期窗口：超过这个时间没再改过的文件不参与重叠判断。 */
  windowMs: 6 * 60 * 60 * 1000,
  /** 每个对话最多保留的文件数，超出时丢最旧的。 */
  maxFilesPerConversation: 200,
  /** 展示用路径的字符上限。 */
  pathLength: 1_000,
} as const;

/** 一个对话近期改过的一个文件。 */
export interface ConversationEditedFile {
  /** 绝对路径；不同 worktree 里的同名文件是不同的路径，不会被判为重叠。 */
  path: string;
  /** 相对对话工作目录的路径，工作目录之外的保持绝对路径。 */
  relativePath: string;
  editedAt: number;
  /** 窗口内 edit / write 的成功次数。 */
  edits: number;
}

export interface ConversationEditSummary {
  conversationId: string;
  title: string;
  cwd: string;
  /** 按最近修改时间倒序。 */
  files: ConversationEditedFile[];
}

/** 一个文件被多个对话改过。 */
export interface FileOverlap {
  path: string;
  /** 以第一个对话的视角显示的相对路径。 */
  relativePath: string;
  /** 改过它的对话，最近修改的在前。至少两个。 */
  conversations: Array<{ conversationId: string; title: string; editedAt: number }>;
}

export interface ConflictsState {
  /** 有近期改动的对话，最近活跃的在前。 */
  conversations: ConversationEditSummary[];
  overlaps: FileOverlap[];
  windowMs: number;
  error: string | null;
}

export interface MoveToWorktreeResult {
  /** 在新 worktree 里创建的对话。 */
  conversationId: string;
  branch: string;
  worktree: string;
  /** 预填进新对话输入框的交接文本。 */
  seed: string;
}

export interface ConflictsApi {
  list(): Promise<ConflictsState>;
  /** 从对话所在仓库的 HEAD 建一个新分支 worktree，并在其中新建对话。 */
  moveToWorktree(conversationId: string): Promise<MoveToWorktreeResult>;
  subscribe(listener: () => void): () => void;
}

export const ConflictIpc = {
  list: "conflicts:list",
  moveToWorktree: "conflicts:move-to-worktree",
  state: "conflicts:state",
} as const;

export const emptyConflictsState: ConflictsState = {
  conversations: [],
  overlaps: [],
  windowMs: conflictLimits.windowMs,
  error: null,
};

/** 某个对话涉及的重叠文件；没有时返回空数组。 */
export function overlapsForConversation(state: ConflictsState, conversationId: string): FileOverlap[] {
  return state.overlaps.filter(overlap => overlap.conversations.some(entry => entry.conversationId === conversationId));
}

/** 与指定对话改了同一文件的其他对话，按重叠文件数多到少。 */
export function conflictingConversations(
  state: ConflictsState,
  conversationId: string,
): Array<{ conversationId: string; title: string; files: string[] }> {
  const others = new Map<string, { conversationId: string; title: string; files: string[] }>();
  for (const overlap of overlapsForConversation(state, conversationId)) {
    for (const entry of overlap.conversations) {
      if (entry.conversationId === conversationId) continue;
      const item = others.get(entry.conversationId) ?? { conversationId: entry.conversationId, title: entry.title, files: [] };
      item.files.push(overlap.relativePath);
      others.set(entry.conversationId, item);
    }
  }
  return [...others.values()].sort((a, b) => b.files.length - a.files.length);
}
