import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { memo, useCallback, useContext, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { trailingParagraphEnd, partitionMarkdown, wholeMarkdown, type MarkdownPartition } from "./markdown-blocks";
import { remarkScriptGap } from "./markdown-script-gap";
import { advanceFreshCuts, completeInline, remarkFresh, type FreshCuts } from "./markdown-fresh";
import { useReducedMotion } from "../hooks/useMotionPresence";
import { useFilePreview, type FilePreviewContextValue } from "./preview/FilePreviewContext";
import { tr, useAppLocale } from "../locale";
import { ConversationLinkContext } from "./ConversationLinkContext";

const remarkPlugins = [remarkGfm, remarkBreaks, remarkScriptGap];

/** 动画时长的上限;超过它的批次不需要再播放。 */
const FRESH_SPAN_MS = 600;

/**
 * 淡入批次的元素。结构变化(粗体收尾、链接闭合等)会让已经出现的文字被重建,
 * 这时按出现时间给负的 animation-delay,动画从正确的进度接着播,而不是重头再来。
 */
function MarkdownSpan({ node: _node, className, children, ...props }: { node?: unknown; className?: string; children?: ReactNode; "data-born"?: number | string }) {
  const born = Number(props["data-born"]);
  const ref = useCallback((element: HTMLSpanElement | null) => {
    if (!element || !Number.isFinite(born)) return;
    element.style.animationDelay = `${-Math.min(Math.max(performance.now() - born, 0), FRESH_SPAN_MS)}ms`;
  }, [born]);
  return <span ref={ref} className={className} {...props}>{children}</span>;
}

const baseComponents: Components = {
  span: MarkdownSpan,
  a: MarkdownLink,
  img: MarkdownImage,
  table: MarkdownTable,
};

/** 有预览上下文时,内联代码若是工作区里的真实文件路径就变成可点击引用。 */
function withFileReference(preview: FilePreviewContextValue): Components {
  return {
    ...baseComponents,
    code: MarkdownCodeFactory(preview),
  };
}

function MarkdownCodeFactory(preview: FilePreviewContextValue) {
  return function MarkdownCode({ className, children }: { className?: string; children?: ReactNode }) {
    // 代码块(带 language- 前缀或含换行)保持原样。
    if (className || isBlockCode(children)) {
      return (
        <code className={className}>
          {children}
        </code>
      );
    }
    const text = flattenText(children);
    if (!isLikelyPath(text)) return <code>{children}</code>;
    const filePath = preview.resolveFilePath(text);
    if (!filePath) return <code>{children}</code>;
    return (
      <code
        className="code-file-ref"
        role="button"
        tabIndex={0}
        title={`${tr("打开", "Open")} ${filePath}`}
        onClick={() => preview.openFile(filePath)}
        onKeyDown={(event) => {
          if (event.key === "Enter") preview.openFile(filePath);
        }}
      >
        {children}
      </code>
    );
  };
}

function isBlockCode(children: ReactNode): boolean {
  if (Array.isArray(children)) return children.some((child) => typeof child === "string" && child.includes("\n"));
  return typeof children === "string" && children.includes("\n");
}

function flattenText(children: ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(flattenText).join("");
  if (children && typeof children === "object" && "props" in children) {
    return flattenText((children as { props: { children?: ReactNode } }).props?.children);
  }
  return "";
}

function isLikelyPath(text: string): boolean {
  const value = text.trim();
  if (value.length < 3 || value.length > 260) return false;
  if (/\s/.test(value)) return false;
  return /\.[A-Za-z0-9]+$/.test(value) || value.includes("/");
}

function MarkdownLink({ href, children }: { href?: string; children?: ReactNode }) {
  const openLink = useContext(ConversationLinkContext);
  if (!href) return <span>{children}</span>;
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" onClick={(event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (openLink?.(href)) event.preventDefault();
    }}>
      {children}
    </a>
  );
}

function MarkdownImage({ src, alt }: { src?: string; alt?: string }) {
  if (!src) return null;
  return <img src={src} alt={alt ?? ""} />;
}

function MarkdownTable({ children }: { children?: ReactNode }) {
  return (
    <div className="md-table-scroll">
      <table>{children}</table>
    </div>
  );
}

function safeUrl(url: string): string {
  const value = url.trim();
  const separator = value.indexOf(":");
  if (separator <= 0) return "";
  const protocol = value.slice(0, separator).toLowerCase();
  if (protocol === "https" || protocol === "http" || protocol === "mailto") return value;
  return "";
}

const MarkdownBlockView = memo(function MarkdownBlockView({ text, components, entering, motionAllowed, fade, completing, trailing }: {
  text: string; components: Components; entering: boolean; motionAllowed: boolean; fade: MarkdownFade | false; completing: boolean; trailing?: ReactNode;
}) {
  useAppLocale();
  const arrival = useRef(entering);
  // 渲染期间只追加记录,重复渲染不会产生重复批次。
  const fresh = useRef<FreshCuts>({ length: entering ? 0 : text.length, cuts: [], born: [] });
  const batches = fade ? advanceFreshCuts(fresh.current, text.length) : undefined;
  const plugins = useMemo(
    () => batches && motionAllowed ? [remarkGfm, remarkScriptGap, [remarkFresh, batches.cuts, batches.born], remarkBreaks] as typeof remarkPlugins : remarkPlugins,
    [batches?.cuts, batches?.born, motionAllowed],
  );
  useLayoutEffect(() => { if (!motionAllowed) arrival.current = false; }, [motionAllowed]);
  // 附加内容优先排进最后一行;文档不以段落结尾时退到块末尾,保证它始终可见。
  const trailingEnd = trailing === undefined ? undefined : trailingParagraphEnd(text);
  const blockComponents: Components = useMemo(
    () => trailingEnd === undefined
      ? components
      : { ...components, p: ({ children, node }) => <p>{children}{node?.position?.end.offset === trailingEnd ? trailing : null}</p> },
    [components, trailingEnd, trailing],
  );
  return <div className={`md-block${fade ? ` fade-${fade}` : ""}${arrival.current && motionAllowed && !fade ? " is-entering" : ""}`}>
    <ReactMarkdown remarkPlugins={plugins} urlTransform={safeUrl} components={blockComponents}>
      {completing && fade && motionAllowed ? completeInline(text) : text}
    </ReactMarkdown>
    {trailing !== undefined && trailingEnd === undefined ? trailing : null}
  </div>;
});

/** soft:思考内容轻轻淡入;pop:正式回复先淡入、轻轻弹起再落回。 */
export type MarkdownFade = "reply" | "thinking";

export const Markdown = memo(function Markdown({ text, streaming = false, fade = false, resumed = false, trailing }: {
  text: string;
  streaming?: boolean;
  /** 流式追加的文字逐批出现的动画;已显示的文字不重播。 */
  fade?: MarkdownFade | false;
  /** 挂载时已有的文字之前已经展示过(从另一处组件接着放),不再为它们播放出现动画。 */
  resumed?: boolean;
  /** 追加到文档末尾段落行尾的内容,例如思考总结末尾的开合图标。 */
  trailing?: ReactNode;
}) {
  useAppLocale();
  const preview = useFilePreview();
  const components = useMemo(
    () => (preview ? withFileReference(preview) : baseComponents),
    [preview],
  );
  const reduced = useReducedMotion();
  const committed = useRef<MarkdownPartition | undefined>(undefined);
  // Static documents keep their original single parse. After streaming, retain
  // the partition so completion doesn't remount settled content or selection.
  const incremental = streaming || committed.current?.wholeDocument === false;
  const partition = useMemo(() => incremental ? partitionMarkdown(text, committed.current) : wholeMarkdown(text), [text, incremental]);
  const initialOffsets = useRef(new Set((streaming && !resumed ? partition.blocks.slice(0, -1) : partition.blocks).map((block) => block.offset)));
  useLayoutEffect(() => { committed.current = partition; }, [partition]);
  const lastOffset = partition.blocks.at(-1)?.offset;
  return (
    <div className="md-content">
      {partition.blocks.map((block) => <MarkdownBlockView key={block.offset} text={block.text}
        trailing={block.offset === lastOffset ? trailing : undefined}
        components={components} fade={fade} completing={streaming && block.offset === lastOffset} motionAllowed={!reduced && !partition.wholeDocument} entering={streaming && !reduced && !partition.wholeDocument &&
          block.offset === lastOffset && !initialOffsets.current.has(block.offset)} />)}
    </div>
  );
});
