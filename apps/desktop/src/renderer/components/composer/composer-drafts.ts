import type { FileAttachmentPayload } from "@vela/shared";

interface ComposerDraft {
  text: string;
  attachments: readonly FileAttachmentPayload[];
}

const emptyDraft: ComposerDraft = { text: "", attachments: [] };

/**
 * 输入框草稿：按对话分开保存，切到别的对话、新窗口或输入框被卸载之后再回来仍然保留。
 * 只存在于渲染进程内存里（重启应用后不保留）。新窗口还没有对话 ID，共用一份。
 */
export function createComposerDrafts() {
  const drafts = new Map<string, ComposerDraft>();
  const listeners = new Set<() => void>();
  const presenceListeners = new Set<() => void>();
  const get = (key: string) => drafts.get(key) ?? emptyDraft;
  function set(key: string, patch: Partial<ComposerDraft>): void {
    const current = get(key);
    const { text, attachments } = { ...current, ...patch };
    const nextText = text.trim() ? text : "";
    if (nextText === current.text && (attachments === current.attachments || (!attachments.length && !current.attachments.length))) return;
    const hadDraft = current !== emptyDraft;
    const hasDraft = Boolean(nextText || attachments.length);
    if (hasDraft) drafts.set(key, { text: nextText, attachments });
    else drafts.delete(key);
    if (hadDraft !== hasDraft) {
      for (const listener of presenceListeners) listener();
    }
    for (const listener of listeners) listener();
  }
  return {
    get, set,
    conversationDraftLocation(id: string): "main" | "workbench" | null {
      if (drafts.has(composerDraftKey(id, false))) return "main";
      return drafts.has(composerDraftKey(id, true)) ? "workbench" : null;
    },
    subscribePresence(listener: () => void) {
      presenceListeners.add(listener);
      return () => { presenceListeners.delete(listener); };
    },
    restoreIfEmpty(key: string, draft: ComposerDraft): void {
      if (get(key) === emptyDraft) set(key, draft);
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

export const composerDrafts = createComposerDrafts();

/**
 * 嵌入的工作台聊天和主聊天可能同时显示同一个对话，各自一份草稿，互不覆盖。
 * 还没有消息的新对话不在侧边栏里列出，离开后就回不去了，
 * 所以它们共用一份「新对话」草稿：下一次打开新对话时接着写。
 */
export function composerDraftKey(conversationId: string | null, embedded: boolean, newChat = false): string {
  if (newChat && !embedded) return "new";
  return `${embedded ? "embedded" : "main"}:${conversationId ?? ""}`;
}
