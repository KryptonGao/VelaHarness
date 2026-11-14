import { memo, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { activeIntlLocale, tr, trf } from "../locale";
import { nextTurnNavReveal, positionTurnNavPopover, type TurnNavItem } from "./turn-nav";

function formatTurnTime(timestamp: number | null): string | null {
  if (timestamp === null) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  const locale = activeIntlLocale();
  if (date.toDateString() === new Date().toDateString()) {
    return date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleString(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * 长对话左侧的圆点导航：默认隐藏，指针靠近左侧或键盘聚焦时显现；
 * 当前视口所在轮次保持深色圆点，悬停圆点展示本轮要求与回复摘要，点击跳转。
 * 提示卡片挂在滚动轨道之外，避免轮次很多时被轨道自身的 overflow 裁切。
 */
export const TurnNav = memo(function TurnNav({
  items,
  activeIndex,
  onJump,
}: {
  items: readonly TurnNavItem[];
  activeIndex: number;
  onJump: (turnId: string, index: number) => void;
}) {
  const navRef = useRef<HTMLElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const dotRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [nearLeft, setNearLeft] = useState(false);
  const nearLeftRef = useRef(false);
  nearLeftRef.current = nearLeft;
  const [railHovered, setRailHovered] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [popoverTop, setPopoverTop] = useState<number>(0);

  const visible = nearLeft || railHovered || focusWithin;

  useEffect(() => {
    const nav = navRef.current;
    const pane = nav?.parentElement;
    if (!nav || !pane) return;

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const paneRect = pane.getBoundingClientRect();
      const navRect = nav.getBoundingClientRect();
      const inVerticalBand = event.clientY >= paneRect.top && event.clientY <= navRect.bottom + 24;
      const next = inVerticalBand && nextTurnNavReveal(nearLeftRef.current, event.clientX - paneRect.left);
      if (next !== nearLeftRef.current) {
        nearLeftRef.current = next;
        setNearLeft(next);
      }
    };
    const onPointerLeave = () => {
      if (nearLeftRef.current) {
        nearLeftRef.current = false;
        setNearLeft(false);
      }
      setRailHovered(false);
      setHoveredIndex(null);
    };

    pane.addEventListener("pointermove", onPointerMove, { passive: true });
    pane.addEventListener("pointerleave", onPointerLeave);
    return () => {
      pane.removeEventListener("pointermove", onPointerMove);
      pane.removeEventListener("pointerleave", onPointerLeave);
    };
  }, []);

  useEffect(() => {
    if (!visible) setHoveredIndex(null);
  }, [visible]);

  // 对话变短或切换会话导致索引越界时及时收起悬浮卡片。
  useEffect(() => {
    setHoveredIndex((current) => (current !== null && current >= items.length ? null : current));
  }, [items.length]);

  // 轮次很多且轨道自身可滚时，保持当前活跃圆点始终处于轨道可见区。
  useEffect(() => {
    const rail = railRef.current;
    const activeDot = dotRefs.current[activeIndex];
    if (!rail || !activeDot || rail.scrollHeight <= rail.clientHeight) return;
    activeDot.scrollIntoView({ block: "nearest" });
  }, [activeIndex, visible]);

  useLayoutEffect(() => {
    if (!visible || hoveredIndex === null) return;
    const nav = navRef.current;
    const dot = dotRefs.current[hoveredIndex];
    const popover = popoverRef.current;
    if (!nav || !dot || !popover) return;
    const navRect = nav.getBoundingClientRect();
    const dotRect = dot.getBoundingClientRect();
    const dotCenterY = dotRect.top + dotRect.height / 2 - navRect.top;
    const { top } = positionTurnNavPopover({
      dotCenterY,
      popoverHeight: popover.offsetHeight,
      railHeight: navRect.height,
    });
    setPopoverTop(top);
  }, [hoveredIndex, items, visible]);

  const hoveredItem = visible && hoveredIndex !== null ? items[hoveredIndex] ?? null : null;
  const formattedTime = hoveredItem ? formatTurnTime(hoveredItem.timestamp) : null;

  const moveFocus = (nextIndex: number) => {
    const clamped = Math.max(0, Math.min(items.length - 1, nextIndex));
    dotRefs.current[clamped]?.focus();
    setHoveredIndex(clamped);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveFocus(index + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      moveFocus(0);
    } else if (event.key === "End") {
      event.preventDefault();
      moveFocus(items.length - 1);
    } else if (event.key === "Escape") {
      setHoveredIndex(null);
      setFocusWithin(false);
    }
  };

  return (
    <nav
      ref={navRef}
      className="turn-nav"
      data-visible={visible ? "true" : undefined}
      aria-label={tr("对话轮次导航", "Conversation turn navigation")}
    >
      <div
        ref={railRef}
        className="turn-nav-rail"
        onMouseEnter={() => setRailHovered(true)}
        onMouseLeave={() => {
          setRailHovered(false);
          setHoveredIndex(null);
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setFocusWithin(false);
            setHoveredIndex(null);
          }
        }}
      >
        {items.map((item, index) => {
          const active = index === activeIndex;
          const hovered = index === hoveredIndex;
          return (
            <button
              key={item.id}
              ref={(element) => {
                dotRefs.current[index] = element;
              }}
              type="button"
              className="turn-nav-item"
              data-turn-index={index}
              data-active={active ? "true" : undefined}
              data-hovered={hovered ? "true" : undefined}
              aria-current={active ? "true" : undefined}
              aria-label={trf("第 {0} 轮：{1}", "Turn {0}: {1}", index + 1, item.prompt)}
              tabIndex={active || (activeIndex < 0 && index === 0) ? 0 : -1}
              onPointerEnter={(event) => {
                if (event.pointerType !== "touch") {
                  setRailHovered(true);
                  setHoveredIndex(index);
                }
              }}
              onFocus={(event) => {
                if (event.currentTarget.matches(":focus-visible")) {
                  setFocusWithin(true);
                  setHoveredIndex(index);
                }
              }}
              onKeyDown={(event) => handleKeyDown(event, index)}
              onClick={() => onJump(item.id, index)}
            >
              <span className="turn-nav-dot" aria-hidden="true" />
            </button>
          );
        })}
      </div>
      {hoveredItem ? (
        <div
          ref={popoverRef}
          className="turn-nav-popover"
          role="tooltip"
          style={{ top: popoverTop }}
        >
          <div className="turn-nav-popover-prompt">{hoveredItem.prompt}</div>
          {hoveredItem.replyPreview ? (
            <div className="turn-nav-popover-reply">{hoveredItem.replyPreview}</div>
          ) : null}
          <div className="turn-nav-popover-meta">
            <span>{trf("第 {0} / {1} 轮", "{0} of {1}", hoveredItem.index + 1, items.length)}</span>
            {formattedTime && hoveredItem.timestamp !== null ? (
              <time dateTime={new Date(hoveredItem.timestamp).toISOString()}>{formattedTime}</time>
            ) : null}
          </div>
        </div>
      ) : null}
    </nav>
  );
});
