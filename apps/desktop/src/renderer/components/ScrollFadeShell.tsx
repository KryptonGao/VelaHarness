import { useId, type CSSProperties, type ReactNode } from "react";
import { ThinkingEdgeBlur } from "./ThinkingEdgeBlur";
import { SCROLL_EDGE_HEIGHT } from "./thinking-edges";

/**
 * Shared painting for thinking, task summaries and conclusions; callers own scrolling.
 * Edge strength follows the viewport's scroll position through a CSS scroll timeline
 * (06-chat-messages.css), so it advances with the scroll instead of waiting on React.
 */
export function ScrollFadeShell({ children, className, height, overflowing, enabled = true }: {
  children: ReactNode;
  className?: string;
  height: number;
  /** An inactive scroll timeline would pin the edges at full strength, so they only run while content overflows. */
  overflowing: boolean;
  enabled?: boolean;
}) {
  const filterId = `${useId()}-edge-blur`;
  if (!enabled) {
    return <div className={`thinking-scroll-shell${className ? ` ${className}` : ""}`}>{children}</div>;
  }
  return (
    <div
      className={`thinking-scroll-shell has-content-edge-blur${overflowing ? " has-overflow" : ""}${className ? ` ${className}` : ""}`}
      style={{
        "--thinking-edge-height": `${Math.min(SCROLL_EDGE_HEIGHT, height / 2)}px`,
        "--scroll-edge-filter": `url("#${filterId}")`,
      } as CSSProperties}
    >
      <ThinkingEdgeBlur id={filterId} height={height} />
      {children}
      <div className="thinking-scroll-fade thinking-scroll-fade-top" aria-hidden="true" />
      <div className="thinking-scroll-fade thinking-scroll-fade-bottom" aria-hidden="true" />
    </div>
  );
}
