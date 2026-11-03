import { useLayoutEffect, useRef, useState, type ReactNode, type TouchEvent, type WheelEvent } from "react";
import { nextStreamFollow, releasesStreamFollow } from "./chat-scroll";
import { ScrollFadeShell } from "./ScrollFadeShell";
import { thinkingEdges } from "./thinking-edges";

/**
 * 限高滚动容器：内容超过高度时上下显示渐进模糊，和思考内容展开使用同一套视觉。
 * 内容保持挂载；Markdown 异步渲染或内容高度变化由 ResizeObserver 重新计算边缘状态。
 */
export function ScrollFade({
  children,
  className,
  contentClassName,
  ariaLabel,
  followEnd = false,
  fade = true,
}: {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  ariaLabel?: string;
  /** 内容在增长时（流式写入）视口跟着滚到底部。 */
  followEnd?: boolean;
  /** 是否在滚动区域上下显示渐进模糊和渐隐遮罩。 */
  fade?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ top: 0, bottom: 0 });
  const [viewportHeight, setViewportHeight] = useState(0);

  const followEndRef = useRef(followEnd);
  followEndRef.current = followEnd;
  // 只有用户停在底部时才跟随;向上滚动后保持当前位置,滚回底部再恢复。
  const follow = useRef({ pinned: true, lastScrollTop: 0 });
  const touchY = useRef(0);

  const scrollToEnd = (viewport: HTMLElement): void => {
    viewport.scrollTop = viewport.scrollHeight;
    // 记录程序化滚动后的位置,避免随后触发的 scroll 事件被误判为用户滚离底部。
    follow.current.lastScrollTop = viewport.scrollTop;
  };

  const handleScroll = (): void => {
    const viewport = scrollRef.current;
    if (viewport) {
      follow.current.pinned = nextStreamFollow({
        following: follow.current.pinned,
        scrollTop: viewport.scrollTop,
        previousScrollTop: follow.current.lastScrollTop,
        distanceFromBottom: viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight,
      });
      follow.current.lastScrollTop = viewport.scrollTop;
    }
    sync();
  };

  // 在滚动真正发生前就解除跟随,避免输出恰好插入时把视口又拉回底部。
  const releaseFollow = (towardEarlier: boolean): void => {
    const viewport = scrollRef.current;
    if (viewport && releasesStreamFollow(viewport.scrollTop, towardEarlier)) follow.current.pinned = false;
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>): void => releaseFollow(event.deltaY < 0);

  const handleTouchStart = (event: TouchEvent<HTMLDivElement>): void => {
    touchY.current = event.touches[0]?.clientY ?? touchY.current;
  };

  const handleTouchMove = (event: TouchEvent<HTMLDivElement>): void => {
    const y = event.touches[0]?.clientY;
    if (y == null) return;
    releaseFollow(y > touchY.current + 2);
    touchY.current = y;
  };

  const sync = (): void => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    setViewportHeight(viewport.clientHeight);
    const next = thinkingEdges(viewport.scrollTop, viewport.scrollHeight, viewport.clientHeight);
    setEdges((current) =>
      current.top === next.top && current.bottom === next.bottom ? current : next,
    );
  };

  useLayoutEffect(() => {
    const viewport = scrollRef.current;
    const content = contentRef.current;
    if (!viewport) return;
    sync();
    // 只在内容长高且用户仍贴底时跟随到底部，向上滚动后不再拉回去。
    const observer = new ResizeObserver(() => {
      if (followEndRef.current && follow.current.pinned) scrollToEnd(viewport);
      sync();
    });
    observer.observe(viewport);
    if (content) observer.observe(content);
    return () => observer.disconnect();
  }, []);

  return (
    <ScrollFadeShell className={className} edges={edges} height={viewportHeight} enabled={fade}>
      <div
        className="thinking-scroll-viewport"
        ref={scrollRef}
        onScroll={handleScroll}
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        role="region"
        aria-label={ariaLabel}
        tabIndex={0}
      >
        <div className={`thinking-text${contentClassName ? ` ${contentClassName}` : ""}`} ref={contentRef}>
          {children}
        </div>
      </div>
    </ScrollFadeShell>
  );
}
