import { useLayoutEffect, useRef, type ReactNode } from "react";

/** Collapse only as much as the rendered controls need, independent of locale or UI scale. */
const COLLAPSE_ORDER = ["speed", "totals", "percent", "permission", "context", "reasoning", "model-arrow", "quota"];

export function ComposerTray({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const tray = ref.current;
    if (!tray) return;
    let frame = 0;
    const observed = new Set<Element>();
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; fit(); });
    };
    const resize = new ResizeObserver(schedule);
    const fit = () => {
      const left = tray.querySelector<HTMLElement>(".composer-tray-left");
      const right = tray.querySelector<HTMLElement>(".composer-tray-right");
      if (!left || !right) return;

      // Watch intrinsic control sizes too: model, usage and font changes need not resize the tray.
      const targets = new Set<Element>([tray, left, right, ...right.querySelectorAll(".composer-stats-row, .model-controls")]);
      for (const target of observed) {
        if (!targets.has(target)) { resize.unobserve(target); observed.delete(target); }
      }
      for (const target of targets) {
        if (!observed.has(target)) { resize.observe(target); observed.add(target); }
      }

      if (!tray.clientWidth) return;

      // Measure with the model at its normal capped width, rather than hiding the shortage
      // by squeezing its name. All temporary changes are resolved before the next paint.
      tray.dataset.measuring = "true";
      const style = getComputedStyle(tray);
      const edge = tray.getBoundingClientRect().right - parseFloat(style.paddingRight);
      const gap = parseFloat(style.columnGap) || 0;
      for (let count = 0; count <= COLLAPSE_ORDER.length; count++) {
        tray.dataset.collapsed = COLLAPSE_ORDER.slice(0, count).join(" ");
        const controls = [...right.children].filter((node) => node.getBoundingClientRect().width > 0);
        const first = controls[0]?.getBoundingClientRect();
        const last = controls.at(-1)?.getBoundingClientRect();
        if (!first || !last || (first.left >= left.getBoundingClientRect().right + gap - 0.5 && last.right <= edge + 0.5)) break;
      }
      delete tray.dataset.measuring;
    };
    // React can replace or add controls asynchronously (for example the quota ring).
    const mutations = new MutationObserver(schedule);
    mutations.observe(tray, { childList: true, characterData: true, subtree: true });
    fit();
    document.fonts.addEventListener("loadingdone", schedule);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutations.disconnect();
      document.fonts.removeEventListener("loadingdone", schedule);
    };
  }, []);

  return <div className="composer-tray" ref={ref}>{children}</div>;
}
