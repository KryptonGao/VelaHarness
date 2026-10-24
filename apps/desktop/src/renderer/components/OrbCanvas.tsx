import { useEffect, useRef } from "react";
import {
  ORB_MORPH_MS,
  blendOrbFrames,
  orbFrame,
  orbMorphEase,
  type OrbFrame,
  type OrbStyle,
} from "./jump-orb";

const prefersReducedMotion = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

interface OrbPlayback {
  style: OrbStyle | undefined;
  /** 当前样式开始播放的时刻(performance.now 毫秒)。 */
  since: number;
  /** 换样式时上一个样式最后画出的一帧;过渡结束后清空。 */
  from: OrbFrame | null;
  last: OrbFrame | null;
}

/**
 * 所有样式共用同一组 4 个点和一条线。换样式时点从上一帧的位置滑向新样式,
 * 新样式从它自己的起始姿势开始播放,所以任意两个样式之间都是连贯的。
 */
export function OrbCanvas({ style, running, visible, className = "jump-orb", viewBox = "0 0 30 30" }: {
  style: OrbStyle | undefined;
  running: boolean;
  visible: boolean;
  className?: string;
  viewBox?: string;
}) {
  const path = useRef<SVGPathElement>(null);
  const ghost = useRef<SVGPathElement>(null);
  const dots = useRef<Array<SVGCircleElement | null>>([]);
  const playback = useRef<OrbPlayback>({ style: undefined, since: 0, from: null, last: null });

  useEffect(() => {
    const state = playback.current;
    if (!style) {
      state.style = undefined;
      state.from = null;
      return;
    }
    const reduced = prefersReducedMotion();
    if (state.style !== style) {
      state.from = reduced ? null : state.last;
      state.style = style;
      state.since = performance.now();
    }
    const draw = (now: number) => {
      const elapsed = now - state.since;
      const frame = orbFrame(style, reduced ? 0.6 : elapsed / 1000);
      const amount = state.from ? orbMorphEase(Math.min(1, elapsed / ORB_MORPH_MS)) : 1;
      const shown = state.from ? blendOrbFrames(state.from, frame, amount) : frame;
      shown.dots.forEach((item, index) => {
        const node = dots.current[index];
        if (!node) return;
        node.setAttribute("cx", item.x.toFixed(2));
        node.setAttribute("cy", item.y.toFixed(2));
        node.setAttribute("r", Math.max(0, item.r).toFixed(2));
        node.style.opacity = item.o.toFixed(2);
      });
      path.current?.setAttribute("d", shown.path);
      if (path.current) path.current.style.opacity = shown.pathOpacity.toFixed(2);
      const leaving = state.from && state.from.path && amount < 1;
      ghost.current?.setAttribute("d", leaving ? state.from!.path : "");
      if (ghost.current) ghost.current.style.opacity = leaving ? (state.from!.pathOpacity * (1 - amount)).toFixed(2) : "0";
      state.last = shown;
      if (amount >= 1) state.from = null;
    };
    if (reduced || !running) {
      draw(performance.now());
      return;
    }
    let frame = requestAnimationFrame(function tick(now) {
      draw(now);
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [style, running]);

  return (
    <svg className={className} viewBox={viewBox} data-on={visible} aria-hidden="true">
      <path ref={ghost} />
      <path ref={path} />
      {[0, 1, 2, 3].map((index) => <circle key={index} ref={(node) => { dots.current[index] = node; }} r="0" />)}
    </svg>
  );
}
