import { flushSync } from "react-dom";

/**
 * Runs a synchronous state update inside a View Transition so layout-changing toggles
 * (workbench fullscreen <-> split) animate as a morph instead of snapping.
 * The `data-view-transition` attribute scopes the `view-transition-name`s to the
 * transition's lifetime; the names create stacking contexts that must not stay on.
 * Falls back to a plain update when unsupported or motion is reduced.
 */
export function withViewTransition(kind: string, update: () => void): void {
  const root = document.documentElement;
  const start = (document as Document & { startViewTransition?: (callback: () => void) => { finished: Promise<unknown> } }).startViewTransition;
  if (!start || root.hasAttribute("data-view-transition") || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { update(); return; }
  root.setAttribute("data-view-transition", kind);
  let transition: { finished: Promise<unknown> };
  try {
    transition = start.call(document, () => { flushSync(update); });
  } catch {
    root.removeAttribute("data-view-transition");
    update();
    return;
  }
  const clear = () => root.removeAttribute("data-view-transition");
  transition.finished.then(clear, clear);
}
