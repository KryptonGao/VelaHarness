import { useEffect, useRef } from "react";

/** 用户正在输入框里写东西时，不能被审批或提问卡片抢走焦点。 */
function userIsTyping(active: HTMLElement): boolean {
  if (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) return active.value.length > 0;
  return (active.textContent ?? "").trim().length > 0;
}

/** 焦点在页面上没有落点（body）或停在空输入框时，才适合把焦点交给需要用户决定的卡片。 */
function canClaimFocus(): boolean {
  const active = document.activeElement;
  if (!active || active === document.body) return true;
  if (!(active instanceof HTMLElement)) return false;
  if (active.isContentEditable || active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) {
    return !userIsTyping(active);
  }
  return false;
}

/**
 * 需要用户决定的卡片（审批、提问）出现时，把焦点移到它的首选控件，处理完再还给原来的元素。
 * 用户正在输入时不抢焦点，只靠朗读通知；`active` 由 false 变 true 时触发一次。
 */
export function useAttentionFocus<T extends HTMLElement>(active: boolean, targetSelector: string) {
  const root = useRef<T>(null);
  const previous = useRef<HTMLElement | null>(null);
  const claimed = useRef(false);

  useEffect(() => {
    if (!active) return;
    const target = root.current?.querySelector<HTMLElement>(targetSelector);
    if (!target || !canClaimFocus()) return;
    const before = document.activeElement;
    previous.current = before instanceof HTMLElement && before !== document.body ? before : null;
    target.focus({ preventScroll: true });
    claimed.current = document.activeElement === target;
    return () => {
      // 卡片收起（处理完或被取消）时，如果焦点还在卡片里或已丢到 body，就还给原来的元素。
      const current = document.activeElement;
      const lost = !current || current === document.body || Boolean(root.current?.contains(current));
      const back = previous.current;
      previous.current = null;
      if (claimed.current && lost && back?.isConnected) back.focus({ preventScroll: true });
      claimed.current = false;
    };
  }, [active, targetSelector]);

  return root;
}
