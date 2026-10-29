export interface ThinkingTitle {
  title: string;
  /** 去掉标题行之后的思考内容,开头的空行也一并去掉。 */
  body: string;
}

const boldLine = /^\*\*([^*]+)\*\*$/;
const headingLine = /^#{1,6}\s+(.+?)(?:\s+#+)?$/;

/**
 * OpenAI 推理模型的 CoT 总结以一行加粗标题开头。第一个非空行是独立的 **标题** 或 # 标题行时,
 * 它就是这段思考的标题;其他供应商的原始思考没有这个形态,返回 null 沿用原有的“思考”展示。
 * 流式输出时标题行没有换行收尾前不算标题,避免把半截标题闪给用户。
 */
export function splitThinkingTitle(text: string, streaming: boolean): ThinkingTitle | null {
  const trimmed = text.trimStart();
  const lineEnd = trimmed.indexOf("\n");
  if (lineEnd === -1 && streaming) return null;
  const line = (lineEnd === -1 ? trimmed : trimmed.slice(0, lineEnd)).trim();
  const title = (boldLine.exec(line) ?? headingLine.exec(line))?.[1]?.trim();
  if (!title) return null;
  const body = lineEnd === -1 ? "" : trimmed.slice(lineEnd + 1).replace(/^\s*\n/, "").trim();
  return { title, body };
}
