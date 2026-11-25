/** Preview a sort with transforms only. The DOM and pane ownership change only on release. */
export function startWorkbenchTabSort(button: HTMLButtonElement, grabX: number) {
  const list = button.closest<HTMLElement>(".workbench-tablist")!;
  const bar = list.closest<HTMLElement>(".workbench-tabbar")!;
  const buttons = Array.from(list.querySelectorAll<HTMLElement>("[role=tab]"));
  const from = buttons.indexOf(button), grip = grabX - button.getBoundingClientRect().left;
  const gap = parseFloat(getComputedStyle(list).columnGap) || 0;
  let scrollFrame = 0;
  function reset() {
    cancelAnimationFrame(scrollFrame); scrollFrame = 0;
    delete list.dataset.sorting;
    for (const b of buttons) b.style.removeProperty("--tab-shift");
  }
  function move(x: number, y: number): number | null {
    const bounds = list.getBoundingClientRect(), header = bar.getBoundingClientRect();
    if (x < bounds.left || x > bounds.right || y < header.top || y > header.bottom) { reset(); return null; }
    // offsetLeft ignores our presentation transforms; moving neighbours cannot change hit testing.
    const last = buttons[buttons.length - 1], width = button.offsetWidth;
    const left = Math.max(0, Math.min(last.offsetLeft + last.offsetWidth - width, x - bounds.left + list.scrollLeft - grip));
    const slot = buttons.findIndex((b, i) => i !== from && (i < from ? left : left + width) < b.offsetLeft + b.offsetWidth / 2);
    const index = slot < 0 ? buttons.length : slot;
    const shifts = buttons.map((b, i) => b === button ? left - b.offsetLeft :
      i >= index && i < from ? width + gap : i > from && i < index ? -width - gap : 0);
    list.dataset.sorting = "";
    buttons.forEach((b, i) => b.style.setProperty("--tab-shift", `${shifts[i]}px`));
    cancelAnimationFrame(scrollFrame);
    const edge = Math.min(32, bounds.width / 4);
    const speed = x < bounds.left + edge ? -Math.ceil((bounds.left + edge - x) / 3) :
      x > bounds.right - edge ? Math.ceil((x - bounds.right + edge) / 3) : 0;
    if (speed && (speed < 0 ? list.scrollLeft > 0 : list.scrollLeft < list.scrollWidth - list.clientWidth - 0.5)) {
      scrollFrame = requestAnimationFrame(() => { list.scrollLeft += speed; move(x, y); });
    }
    return index;
  }
  function settle(commit: () => void) {
    const before = buttons.map(b => b.getBoundingClientRect().left);
    reset(); commit(); // The caller synchronously commits the final DOM order before measuring again.
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const offsets = buttons.map((b, i) => before[i] - b.getBoundingClientRect().left);
    const animations = buttons.flatMap((b, i) => Math.abs(offsets[i]) < 0.5 ? [] :
      [b.animate([{ translate: `${offsets[i]}px` }, { translate: "0px" }], { duration: 170, easing: "cubic-bezier(.2,.8,.2,1)" })]);
    if (!animations.length) return;
    list.dataset.settling = "";
    for (const animation of animations) animation.id = "workbench-tab-settle";
    void Promise.allSettled(animations.map(a => a.finished)).then(() => {
      if (!list.getAnimations({ subtree: true }).some(a => a.id === "workbench-tab-settle")) delete list.dataset.settling;
    });
  }
  for (const a of list.getAnimations({ subtree: true })) if (a.id === "workbench-tab-settle") a.cancel();
  return { move, reset, settle };
}
