import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FileTypeIcon } from "../FileTypeIcon";
import { ChevronRightIcon } from "../icons";
import { usePreviewBreadcrumbMode } from "../../hooks/usePreviewBreadcrumbMode";

const HOVER_LEAVE_CD_MS = 70;

interface PreviewBreadcrumbsProps {
  crumbs: string[];
  current: string;
  iconPath?: string;
  title?: string;
  ariaLabel?: string;
}

/**
 * Full paths scroll horizontally with either wheel axis and fade at clipped
 * edges. The compact mode retains per-segment fades and hover expansion.
 */
export function PreviewBreadcrumbs({
  crumbs,
  current,
  iconPath,
  title,
  ariaLabel,
}: PreviewBreadcrumbsProps) {
  const mode = usePreviewBreadcrumbMode();
  const navRef = useRef<HTMLElement | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const leaveTimerRef = useRef<number | null>(null);
  const crumbsKey = crumbs.join("\0");

  const clearLeaveTimer = () => {
    if (leaveTimerRef.current !== null) {
      window.clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
  };

  useEffect(() => {
    clearLeaveTimer();
    setActiveIndex(null);
    return clearLeaveTimer;
  }, [crumbsKey, current, mode]);

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;

    if (mode === "scroll") {
      let pinnedEnd = true;
      let measuredMax = nav.scrollWidth - nav.clientWidth;
      const updateFade = () => {
        const max = nav.scrollWidth - nav.clientWidth;
        nav.dataset.fadeStart = max > 1 && nav.scrollLeft > 1 ? "true" : "false";
        nav.dataset.fadeEnd = max > 1 && nav.scrollLeft < max - 1 ? "true" : "false";
        // Resizing can clamp scrollLeft before ResizeObserver runs. Preserve
        // the previous end anchor until measure has applied the new bounds.
        if (max === measuredMax) pinnedEnd = nav.scrollLeft >= max - 1;
      };
      const measure = () => {
        measuredMax = nav.scrollWidth - nav.clientWidth;
        if (pinnedEnd) nav.scrollLeft = nav.scrollWidth;
        updateFade();
      };
      const onWheel = (event: WheelEvent) => {
        if (event.ctrlKey || nav.scrollWidth <= nav.clientWidth + 1) return;
        // Use the dominant axis so diagonal trackpad gestures do not double
        // the speed or cancel out. Line/page wheel units also map to pixels.
        const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
        if (!delta) return;
        event.preventDefault();
        const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? nav.clientWidth : 1;
        nav.scrollLeft += delta * unit;
        updateFade();
      };
      measure();
      nav.addEventListener("scroll", updateFade, { passive: true });
      nav.addEventListener("wheel", onWheel, { passive: false });
      const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
      observer?.observe(nav);
      for (const segment of nav.children) observer?.observe(segment);
      return () => {
        observer?.disconnect();
        nav.removeEventListener("scroll", updateFade);
        nav.removeEventListener("wheel", onWheel);
        delete nav.dataset.fadeStart;
        delete nav.dataset.fadeEnd;
      };
    }

    nav.scrollLeft = 0;
    const segments = Array.from(
      nav.querySelectorAll<HTMLElement>(".preview-crumb-text"),
    );

    const measure = () => {
      for (const el of segments) {
        const faded = el.scrollWidth - el.clientWidth > 1 ? "true" : "false";
        if (el.dataset.fade !== faded) {
          el.dataset.fade = faded;
        }
      }
    };

    measure();
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    for (const el of segments) {
      observer.observe(el);
    }
    return () => observer.disconnect();
  }, [crumbsKey, current, mode, iconPath]);

  const handleCrumbEnter = (index: number) => {
    clearLeaveTimer();
    setActiveIndex((prev) => (prev === index ? prev : index));
  };

  const handleCrumbLeave = () => {
    clearLeaveTimer();
    leaveTimerRef.current = window.setTimeout(() => {
      leaveTimerRef.current = null;
      setActiveIndex(null);
    }, HOVER_LEAVE_CD_MS);
  };

  return (
    <nav
      ref={navRef}
      className="preview-breadcrumbs-text"
      data-mode={mode}
      title={title}
      aria-label={ariaLabel}
      tabIndex={mode === "scroll" ? 0 : undefined}
      onKeyDown={event => {
        if (mode !== "scroll" || event.altKey || event.ctrlKey || event.metaKey) return;
        const nav = event.currentTarget;
        const next = event.key === "ArrowLeft" ? nav.scrollLeft - 40
          : event.key === "ArrowRight" ? nav.scrollLeft + 40
          : event.key === "Home" ? 0
          : event.key === "End" ? nav.scrollWidth
          : null;
        if (next === null) return;
        event.preventDefault();
        nav.scrollLeft = next;
      }}
    >
      {crumbs.map((segment, index) => (
        <span
          className="preview-crumb"
          data-active={activeIndex === index ? "true" : undefined}
          key={`${index}:${segment}`}
          onMouseEnter={() => handleCrumbEnter(index)}
          onMouseLeave={handleCrumbLeave}
        >
          {index > 0 ? <ChevronRightIcon size={10} /> : null}
          <span className="preview-crumb-text">{segment}</span>
        </span>
      ))}
      <span
        className="preview-crumb current"
        data-active={activeIndex === crumbs.length ? "true" : undefined}
        onMouseEnter={() => handleCrumbEnter(crumbs.length)}
        onMouseLeave={handleCrumbLeave}
      >
        {crumbs.length > 0 ? <ChevronRightIcon size={10} /> : null}
        {iconPath ? <FileTypeIcon path={iconPath} /> : null}
        <span className="preview-crumb-text">{current}</span>
      </span>
    </nav>
  );
}
