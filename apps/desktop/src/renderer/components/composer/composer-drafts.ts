/**
 * 输入框草稿：按对话分开保存，切到别的对话、新窗口或输入框被卸载之后再回来仍然保留。
 * 只存在于渲染进程内存里（重启应用后不保留）。新窗口还没有对话 ID，共用一份。
 */
export function createComposerDrafts() {
  const drafts = new Map<string, string>();
  return {
    get(key: string): string {
      return drafts.get(key) ?? "";
    },
    set(key: string, text: string): void {
      // 只有空白的内容不值得保留，也避免 Map 里堆积空条目。
      if (text.trim()) drafts.set(key, text);
      else drafts.delete(key);
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
