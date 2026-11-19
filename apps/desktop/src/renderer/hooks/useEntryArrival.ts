import { useLayoutEffect, useRef } from "react";
import { useReducedMotion } from "./useMotionPresence";

/** Track the full data set, not just mounted rows, so virtualization and chunk
 * updates cannot replay arrivals. Animate only currently visible new entries. */
export function useEntryArrival(scope: string, keys: readonly string[], stagger = 20, animateInitial = true) {
  const root = useRef<HTMLElement>(null);
  const seen = useRef(new Set<string>());
  const animations = useRef(new Set<Animation>());
  const reduced = useReducedMotion();
  const primed = useRef(false);
  useLayoutEffect(() => {
    seen.current.clear();
    primed.current = false;
    return () => {
      for (const animation of animations.current) animation.cancel();
      animations.current.clear();
    };
  }, [scope]);
  useLayoutEffect(() => {
    if (reduced) {
      for (const animation of animations.current) animation.cancel();
      animations.current.clear();
    }
  }, [reduced]);
  useLayoutEffect(() => {
    const fresh = keys.some(key => !seen.current.has(key));
    const first = !primed.current;
    primed.current = true;
    // 已见集合只增不减，并且把 DOM 上实际出现的 key 也记进去：
    // 有些节点（连贯分组的 :thinking、可视化工具的 :tool）的 key 不在 keys 里，
    // 若不登记，每来一条新消息整组都会被当成新节点重新淡入，表现为面板突然闪一下。
    const settle = () => {
      for (const key of keys) seen.current.add(key);
      for (const element of root.current?.querySelectorAll<HTMLElement>("[data-arrival-key]") ?? []) {
        seen.current.add(element.dataset.arrivalKey!);
      }
    };
    if ((first && !animateInitial) || !fresh || reduced) {
      if (fresh || first) settle();
      return;
    }
    const viewport = root.current?.getBoundingClientRect();
    let index = 0;
    const entering = new Set<HTMLElement>();
    for (const element of root.current?.querySelectorAll<HTMLElement>("[data-arrival-key]") ?? []) {
      const key = element.dataset.arrivalKey!;
      if (reduced || seen.current.has(key)) continue;
      // A new message already carries its newly mounted descendants.
      if ([...entering].some((parent) => parent.contains(element))) continue;
      const box = element.getBoundingClientRect();
      if (!viewport || box.bottom <= viewport.top || box.top >= viewport.bottom ||
        box.right <= viewport.left || box.left >= viewport.right || !element.getClientRects().length) continue;
      const animation = element.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 140, delay: Math.min(index++ * stagger, 120),
        easing: "cubic-bezier(0.16, 1, 0.3, 1)", fill: "backwards",
      });
      animations.current.add(animation);
      entering.add(element);
      animation.finished.then(() => animations.current.delete(animation), () => animations.current.delete(animation));
    }
    settle();
  }, [keys, scope, reduced, stagger, animateInitial]);
  return root;
}
