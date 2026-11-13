import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FileTypeIcon } from "../FileTypeIcon";
import { ChevronRightIcon } from "../icons";

const HOVER_LEAVE_CD_MS = 70;

interface PreviewBreadcrumbsProps {
  crumbs: string[];
  current: string;
  iconPath?: string;
  title?: string;
  ariaLabel?: string;
}

/**
 * Renders the file-preview breadcrumb trail, marks overflowing segments
 * with `data-fade="true"` so CSS can fade their clipped edge instead of
 * showing ellipsis, and holds active state briefly on leave so sliding
 * between segments hands off directly without collapsing in between.
 */
export function PreviewBreadcrumbs({
  crumbs,
  current,
  iconPath,
  title,
  ariaLabel,
}: PreviewBreadcrumbsProps) {
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
  }, [crumbsKey, current]);

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;

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
  }, [crumbsKey, current]);

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
      title={title}
      aria-label={ariaLabel}
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
