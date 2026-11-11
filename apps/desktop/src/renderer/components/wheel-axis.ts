import { useEffect, type RefObject } from "react";

export type WheelAxis = "x" | "y";

/** 同一次手势里相邻滚轮事件的最大间隔(含触控板惯性);超过它就算新手势,重新判定方向。 */
const GESTURE_IDLE_MS = 160;
/** 离边缘不超过这么多像素仍算停在边缘(容忍小数滚动位置和触控板起手的抖动)。 */
const EDGE_TOLERANCE = 4;
/**
 * 没有新的位移这么久,才认为手已经松开,让内容弹回。DOM 里拿不到触控板的「手指抬起」,只能用停顿近似;
 * 只要滚动还在继续,空白就一直保持并越拉越开。
 */
const PULL_RELEASE_MS = 450;
/** 弹回动画时长。弹回用脚本逐帧取整像素来画,不用 CSS transition:小数像素的位移会让相邻行的色块之间漏出白缝。 */
const PULL_RETURN_MS = 320;

/** 拉出的空白高度上限(像素),无论怎么拉都不会超过。 */
export const PULL_MAX = 12;
/** 越界位移换算成拉出距离的系数,越小越吃力:累计约 100px 的越界才拉出不到 10px。 */
const PULL_RESISTANCE = 0.075;

/** 累计的越界位移换算成实际的拉出距离:阻尼很强,持续拉开时缓慢增长,趋近 extent 而不会超过它。 */
export function rubberBand(stretch: number, extent: number = PULL_MAX): number {
  return Math.sign(stretch) * (1 - 1 / ((Math.abs(stretch) * PULL_RESISTANCE) / extent + 1)) * extent;
}

export interface AxisLock {
  axis: WheelAxis | null;
  lastTime: number;
  /** 最近一次 lockWheelAxis 调用是否开启了新手势。 */
  fresh?: boolean;
}

/** 一次手势只选一个方向:手势的第一个事件里位移更大的那个轴,之后整段手势(含惯性)都沿用。 */
export function lockWheelAxis(lock: AxisLock, deltaX: number, deltaY: number, time: number): WheelAxis {
  lock.fresh = lock.axis === null || time - lock.lastTime > GESTURE_IDLE_MS;
  const axis: WheelAxis = lock.fresh ? (Math.abs(deltaX) > Math.abs(deltaY) ? "x" : "y") : lock.axis!;
  lock.axis = axis;
  lock.lastTime = time;
  return axis;
}

/** 滚轮位移统一成像素;行/页模式按行高和视口估算。 */
function pixels(event: WheelEvent, viewport: HTMLElement): { x: number; y: number } {
  const unitX = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientWidth : 1;
  const unitY = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1;
  return { x: event.deltaX * unitX, y: event.deltaY * unitY };
}

/** 把剩余的纵向位移按由内到外的顺序交给可滚动的祖先容器,每一层滚到头再交给再外一层。 */
function scrollAncestors(start: HTMLElement, deltaY: number): void {
  let rest = deltaY;
  for (let node = start.parentElement; node && Math.abs(rest) >= 1; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY !== "auto" && overflowY !== "scroll") || node.scrollHeight <= node.clientHeight) continue;
    const before = node.scrollTop;
    node.scrollBy({ top: rest, behavior: "instant" });
    rest -= node.scrollTop - before;
  }
}

/** 实验性的「弹性滚动」开关(设置 → 界面):只控制不带动外层时拉出的皮筋空白,不影响带动外层的规则。 */
function elasticScrollEnabled(): boolean {
  return document.documentElement.dataset.elasticScroll === "true";
}

/**
 * 同时可上下、左右滚动的区域,一次手势只允许沿一个方向滚动:
 * 上下滚动时手指/鼠标的左右偏移不会带动横向滚动,反之亦然。
 *
 * 必须接管手势里的每个事件,不能只拦截带偏移的那几个:Chromium 对触控板手势只把第一个滚轮事件作为可取消事件发出,
 * 第一个事件若放行给原生滚动,手势就被锁定在原生滚动上,之后的事件都不可取消,偏移再也拦不住。
 * 所以这里取消每个事件,自己沿锁定方向滚动。
 *
 * 纵向滚到顶部或底部后继续滚动,按下面的规则决定是否带动外层容器(和连贯模式下工具组里原生的滚动传递一致):
 * - 只有手势开始前就已经停在顶部/底部、并且继续朝那个方向滚,才带动外层:剩余位移按由内到外的顺序交给外层可滚动容器
 *   (工具序列容器、再到整个对话),每一层滚到头才交给再外一层。
 * - 手势是在内容中间开始、中途才滚到边界的,到头后的位移(含惯性)丢弃,不会冲出去带动外层。
 * - 已在底部却往上滚,只是内部往上滚,不影响外层;手势中途离开过起始边缘(先往上滚、再折返往下),也不再带动外层。
 * 不带动外层的越界位移默认直接丢弃;实验性的「弹性滚动」(设置 → 界面,默认关闭)开启后,
 * 这部分位移会把内容拉离边缘、露出一块空白(带阻尼,持续滚动就持续拉开),停顿后弹回。
 * 横向到头后的位移始终丢弃,没有外层横向容器可带动。
 */
export function useAxisLockedWheel(ref: RefObject<HTMLElement | null>, enabled = true): void {
  useEffect(() => {
    const viewport = ref.current;
    if (!viewport || !enabled) return;
    const lock: AxisLock = { axis: null, lastTime: 0 };
    // 手势开始那一刻是否已经停在顶部/底部。
    let startedAtTop = false;
    let startedAtBottom = false;
    // 不允许带动外层时,越界的位移把内容拉离边缘,露出空白;正为越过底部,负为越过顶部。
    const content = viewport.firstElementChild instanceof HTMLElement ? viewport.firstElementChild : null;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let stretch = 0;
    let releaseTimer: number | undefined;
    // 拉出的空白沿用离它最近那一行的颜色(白/绿/红),连行号列一起,看起来就像这一行被拉长。
    const markEdge = (): void => {
      const sheet = content?.firstElementChild;
      const edge = stretch > 0 ? sheet?.lastElementChild : sheet?.firstElementChild;
      if (!(edge instanceof HTMLElement)) return;
      viewport.dataset.pullEdge = edge.classList.contains("add") ? "add" : edge.classList.contains("del") ? "del" : "ctx";
      const gutter = edge.querySelector<HTMLElement>(":scope > :first-child");
      viewport.style.setProperty("--pull-gutter", `${gutter?.offsetWidth ?? 0}px`);
    };
    // 位移始终取整数像素:composited 层放在小数像素位置时,相邻两行(尤其是 sticky 的行号列)会各自对齐像素,中间漏出白缝。
    let shown = 0;
    let frame = 0;
    const apply = (y: number): void => {
      shown = y;
      if (content) content.style.transform = y === 0 ? "" : `translateY(${y}px)`;
    };
    const clearEdge = (): void => {
      delete viewport.dataset.pullEdge;
      viewport.style.removeProperty("--pull-gutter");
    };
    const stopReturn = (): void => {
      window.cancelAnimationFrame(frame);
      frame = 0;
    };
    const showStretch = (): void => {
      if (!content || reduceMotion) return;
      window.clearTimeout(releaseTimer);
      stopReturn();
      if (stretch !== 0) markEdge();
      apply(stretch === 0 ? 0 : Math.round(-rubberBand(stretch)));
      releaseTimer = window.setTimeout(releaseStretch, PULL_RELEASE_MS);
    };
    const releaseStretch = (): void => {
      window.clearTimeout(releaseTimer);
      stretch = 0;
      stopReturn();
      if (!content || shown === 0) {
        clearEdge();
        return;
      }
      // 等弹回动画结束再撤掉空白的底色,否则收回途中底色会先消失。
      const from = shown;
      const startedAt = performance.now();
      const step = (now: number): void => {
        const progress = Math.min(1, (now - startedAt) / PULL_RETURN_MS);
        apply(Math.round(from * Math.pow(1 - progress, 3)));
        if (progress < 1) frame = window.requestAnimationFrame(step);
        else {
          frame = 0;
          clearEdge();
        }
      };
      frame = window.requestAnimationFrame(step);
    };
    const onWheel = (event: WheelEvent): void => {
      if (event.ctrlKey || event.defaultPrevented || !event.cancelable) return;
      const delta = pixels(event, viewport);
      if (delta.x === 0 && delta.y === 0) return;
      // 两个方向都没有可滚动的内容时不接管,让外层照常滚动。
      if (viewport.scrollHeight <= viewport.clientHeight && viewport.scrollWidth <= viewport.clientWidth) return;
      const axis = lockWheelAxis(lock, delta.x, delta.y, event.timeStamp);
      if (lock.fresh) {
        if (stretch !== 0) releaseStretch();
        startedAtTop = viewport.scrollTop <= EDGE_TOLERANCE;
        startedAtBottom = viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - EDGE_TOLERANCE;
      }
      event.preventDefault();
      if (axis === "x") {
        viewport.scrollLeft += delta.x;
        return;
      }
      let dy = delta.y;
      // 已经拉出空白时,反向的位移先用来收回空白,收完才轮到内容滚动。
      if (stretch !== 0 && !elasticScrollEnabled()) releaseStretch();
      if (stretch !== 0 && Math.sign(dy) !== Math.sign(stretch)) {
        const back = Math.min(Math.abs(stretch), Math.abs(dy));
        const direction = Math.sign(stretch);
        stretch -= direction * back;
        dy += direction * back;
        showStretch();
        if (dy === 0) return;
      }
      const before = viewport.scrollTop;
      viewport.scrollTop += dy;
      const overflow = dy - (viewport.scrollTop - before);
      // 手势中途离开了起始边缘(例如在底部先往上滚、再折返往下),就不能再靠折返回到边缘去带动外层。
      if (viewport.scrollTop > EDGE_TOLERANCE) startedAtTop = false;
      if (viewport.scrollTop + viewport.clientHeight < viewport.scrollHeight - EDGE_TOLERANCE) startedAtBottom = false;
      if (overflow === 0) return;
      if ((overflow > 0 && startedAtBottom) || (overflow < 0 && startedAtTop)) scrollAncestors(viewport, overflow);
      else if (elasticScrollEnabled()) {
        stretch += overflow;
        showStretch();
      }
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      viewport.removeEventListener("wheel", onWheel);
      window.clearTimeout(releaseTimer);
      stopReturn();
      clearEdge();
      if (content) content.style.transform = "";
    };
  }, [ref, enabled]);
}
