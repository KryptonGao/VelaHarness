import { memo, useEffect, useMemo, useRef } from "react";
import { mayContainUi, UiStreamParser, type UiSegment } from "@vela/shared";
import { Markdown } from "../Markdown";
import { MicroAppView } from "./MicroApp";
import { uiMetrics } from "./ui-metrics-instance";
import { UiArtifactView } from "./UiArtifactView";

interface ParserState {
  parser: UiStreamParser;
  consumed: string;
}

/**
 * 按到达顺序把一条回复渲染成 Markdown 与交互界面。
 * 解析器是增量的：流式时只喂新增的文字；文字不是在原有基础上追加（例如重试）就整体重解析。
 */
function useUiSegments(text: string, streaming: boolean): UiSegment[] {
  const state = useRef<ParserState | null>(null);
  return useMemo(() => {
    let current = state.current;
    if (!current || current.parser.isFinished || !text.startsWith(current.consumed)) {
      current = { parser: new UiStreamParser(), consumed: "" };
    }
    current.parser.feed(text.slice(current.consumed.length));
    current.consumed = text;
    if (!streaming) current.parser.finish();
    state.current = current;
    return current.parser.segments();
  }, [text, streaming]);
}

function WithUi({ messageId, text, streaming }: { messageId: string; text: string; streaming: boolean }) {
  const segments = useUiSegments(text, streaming);
  const lastIndex = segments.length - 1;
  return <>
    {segments.map((segment, index) => segment.type === "markdown"
      ? <Markdown key={segment.key} text={segment.text} streaming={streaming && index === lastIndex} />
      : segment.type === "app"
        ? <MicroAppView key={segment.key} app={segment.app} raw={segment.raw} messageId={messageId} streaming={streaming} />
        : <UiArtifactView key={segment.key} artifact={segment.artifact} raw={segment.raw} messageId={messageId} streaming={streaming} />)}
  </>;
}

/** 只统计这次运行里流式生成完的回复：历史记录每次打开都会重新渲染，不应抬高「生成比例」。 */
function useReplyMetrics(messageId: string, hasUi: boolean, streaming: boolean): void {
  const live = useRef(false);
  if (streaming) live.current = true;
  useEffect(() => {
    if (live.current && !streaming) uiMetrics.assistantMessage(messageId, hasUi);
  }, [messageId, hasUi, streaming]);
}

/** 助手回复正文。没有界面围栏的消息走原来的 Markdown，行为与之前完全一致。 */
export const AssistantMarkdown = memo(function AssistantMarkdown({ messageId, text, streaming = false }: {
  messageId: string; text: string; streaming?: boolean;
}) {
  const hasUi = mayContainUi(text);
  useReplyMetrics(messageId, hasUi, streaming);
  if (!hasUi) return <Markdown text={text} streaming={streaming} />;
  return <WithUi messageId={messageId} text={text} streaming={streaming} />;
});
