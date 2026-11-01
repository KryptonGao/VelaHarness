export const StorageIpc = {
  overview: "storage:overview",
  disk: "storage:disk",
  clean: "storage:clean",
  deleteTrace: "storage:delete-trace",
  reveal: "storage:reveal",
} as const;

/** 资料目录里各类数据的归类；顺序即界面显示顺序。 */
export const storageCategoryIds = [
  "conversations", "traces", "subagents", "checkpoints", "skills", "worktrees", "logs", "updates", "cache", "other",
] as const;
export type StorageCategoryId = (typeof storageCategoryIds)[number];

/** 可以在界面里一键清理的类别；其余类别只能查看并在访达中打开。 */
export const cleanableStorageCategories = ["traces", "logs", "updates", "cache"] as const;
export type CleanableStorageCategory = (typeof cleanableStorageCategories)[number];

export function isCleanableStorageCategory(value: unknown): value is CleanableStorageCategory {
  return typeof value === "string" && (cleanableStorageCategories as readonly string[]).includes(value);
}

export function isStorageCategoryId(value: unknown): value is StorageCategoryId {
  return typeof value === "string" && (storageCategoryIds as readonly string[]).includes(value);
}

export interface StorageCategory {
  id: StorageCategoryId;
  bytes: number;
  files: number;
}

/** 占用最多的对话；大小合计该对话的会话记录、运行轨迹和子代理记录。 */
export interface StorageConversation {
  id: string;
  title: string | null;
  bytes: number;
  traceBytes: number;
  /** 对话的轨迹正被应用使用时不能删除。 */
  traceInUse: boolean;
}

export interface StorageOverview {
  /** 资料目录；仅用于展示。 */
  home: string;
  totalBytes: number;
  categories: StorageCategory[];
  conversations: StorageConversation[];
  measuredAt: number;
}

export interface StorageCleanResult {
  freedBytes: number;
  removedFiles: number;
  /** 因为正在使用而保留的项目数。 */
  skipped: number;
  overview: StorageOverview;
}

/** Vela 所在磁盘的容量；读取很快，用来在分类还在统计时先显示。 */
export interface StorageDisk {
  totalBytes: number;
  freeBytes: number;
}

export interface StorageApi {
  getDisk(): Promise<StorageDisk>;
  getOverview(): Promise<StorageOverview>;
  clean(category: CleanableStorageCategory): Promise<StorageCleanResult>;
  /** 删除某个对话的运行轨迹；对话本身和消息保留。 */
  deleteTrace(conversationId: string): Promise<StorageCleanResult>;
  /** 在访达中打开该类别所在的文件夹。 */
  reveal(category: StorageCategoryId): Promise<void>;
}
