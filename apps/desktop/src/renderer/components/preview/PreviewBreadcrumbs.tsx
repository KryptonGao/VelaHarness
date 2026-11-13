import { useLayoutEffect, useRef } from "react";
import { FileTypeIcon } from "../FileTypeIcon";
import { ChevronRightIcon } from "../icons";

interface PreviewBreadcrumbsProps {
  crumbs: string[];
  current: string;
  iconPath?: string;
  title?: string;
  ariaLabel?: string;
}

/**
 * Renders the file-preview breadcrumb trail and marks overflowing segments
 * with `data-fade="true"` so CSS can fade their clipped edge instead of
 * showing ellipsis.
 */
export function PreviewBreadcrumbs({
  crumbs,
  current,
  iconPath,
  title,
  ariaLabel,
}: PreviewBreadcrumbsProps) {
  const navRef = useRef<HTMLElement | null>(null);
  const crumbsKey = crumbs.join("\0");

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;

    const segments = Array.from(
      nav.querySelectorAll<HTMLElement>(".preview-crumb-text, strong"),
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

  return (
    <nav
      ref={navRef}
      className="preview-breadcrumbs-text"
      title={title}
      aria-label={ariaLabel}
    >
      {crumbs.map((segment, index) => (
        <span className="preview-crumb" key={`${index}:${segment}`}>
          {index > 0 ? <ChevronRightIcon size={10} /> : null}
          <span className="preview-crumb-text">{segment}</span>
        </span>
      ))}
      <span className="preview-crumb current">
        {crumbs.length > 0 ? <ChevronRightIcon size={10} /> : null}
        {iconPath ? <FileTypeIcon path={iconPath} /> : null}
        <strong>{current}</strong>
      </span>
    </nav>
  );
}
