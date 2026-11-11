import type { CSSProperties, ReactNode } from "react";
import { SCROLL_EDGE_HEIGHT } from "./thinking-edges";

/**
 * Shared painting for thinking, task summaries and conclusions; callers own scrolling.
 * Edge strength follows the viewport's scroll position through a CSS scroll timeline
 * (06-chat-messages.css), so it advances with the scroll instead of waiting on React.
 * The edges only fade to the background. Do not add a blur here: an SVG filter on the scroller
 * re-rasterized the whole (nested, full-width) region every frame and saturated the GPU with two
 * open commands, and stacked backdrop-filter layers left rows half sharp and half blurred.
 */
export function ScrollFadeShell({ children, className, height, overflowing, enabled = true }: {
  children: ReactNode;
  className?: string;
  height: number;
  /** An inactive scroll timeline would pin the edges at full strength, so they only run while content overflows. */
  overflowing: boolean;
  enabled?: boolean;
}) {
  if (!enabled) {
    return <div className={`thinking-scroll-shell${className ? ` ${className}` : ""}`}>{children}</div>;
  }
  return (
    <div
      className={`thinking-scroll-shell has-content-edge-blur${overflowing ? " has-overflow" : ""}${className ? ` ${className}` : ""}`}
      style={{
        "--thinking-edge-height": `${Math.min(SCROLL_EDGE_HEIGHT, height / 2)}px`,
      } as CSSProperties}
    >
      {children}
      <div className="thinking-scroll-fade thinking-scroll-fade-top" aria-hidden="true" />
      <div className="thinking-scroll-fade thinking-scroll-fade-bottom" aria-hidden="true" />
    </div>
  );
}
