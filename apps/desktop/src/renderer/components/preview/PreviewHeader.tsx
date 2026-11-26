import { useLayoutEffect, useRef, type ReactNode } from "react";

/** Match the scroll clearance to the rendered toolbar, including wrapped layouts. */
export function usePreviewInset(property: string) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const bar = ref.current;
    const owner = bar?.parentElement;
    if (!bar || !owner) return;
    const update = () => owner.style.setProperty(property, `${bar.offsetHeight}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(bar, { box: "border-box" });
    return () => {
      observer.disconnect();
      owner.style.removeProperty(property);
    };
  }, [property]);
  return ref;
}

export function PreviewHeader({ children }: { children: ReactNode }) {
  const ref = usePreviewInset("--preview-header-height");
  return <div ref={ref} className="preview-subbar pane-info-header">{children}</div>;
}
