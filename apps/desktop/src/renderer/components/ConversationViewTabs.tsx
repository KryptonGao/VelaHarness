import { useLayoutEffect, type KeyboardEvent } from "react";
import { tr, useAppLocale } from "../locale";
import { useSlidingTabIndicator } from "./useSlidingTabIndicator";

export type ConversationViewKey = "chat" | "trace" | "versionControl" | "usage" | "context" | "budget";

const TABS: ReadonlyArray<readonly [ConversationViewKey, string, string]> = [
  ["chat", "对话", "Conversation"],
  ["trace", "轨迹", "Trace"],
  ["versionControl", "版本控制", "Version Control"],
  ["usage", "使用统计", "Usage"],
  ["context", "上下文", "Context"],
  ["budget", "上限设置", "Limit settings"],
];

/** 尚无任何消息时没有内容可看的视图;用量限制是设置项,空对话也能用。 */
const NEEDS_MESSAGES: ReadonlySet<ConversationViewKey> = new Set(["trace", "usage", "context"]);

export function isEmptyConversationView(key: ConversationViewKey, emptyConversation: boolean) {
  return emptyConversation && NEEDS_MESSAGES.has(key);
}

/** 分页按钮与它控制的面板共用的 id；面板不在 DOM 里的视图（版本控制）没有对应面板。 */
export const conversationTabId = (prefix: string, key: ConversationViewKey) => `${prefix}-tab-${key}`;
export const conversationPanelId = (prefix: string, key: ConversationViewKey) =>
  key === "versionControl" ? undefined : `${prefix}-panel-${key === "chat" ? "chat" : "view"}`;

interface ConversationViewTabsProps {
  /** 同一页面可能有多个对话视图（工作面板），id 前缀保证唯一。 */
  idPrefix: string;
  view: ConversationViewKey;
  showVersionControl: boolean;
  /** 对话还没有消息:依赖消息的分页置灰,不可点击。 */
  emptyConversation?: boolean;
  onChange: (next: ConversationViewKey) => void;
}

/** 顶部会话视图选项卡:共享下划线跟随激活项滑动,悬停激活项时向两侧展开。 */
export function ConversationViewTabs({ idPrefix, view, showVersionControl, emptyConversation = false, onChange }: ConversationViewTabsProps) {
  const tabs = useSlidingTabIndicator({ activeKey: view });
  const locale = useAppLocale();

  // 放不下时先收紧间距;仍放不下就交给横向滚动。同步量一次溢出,不会闪烁。
  useLayoutEffect(() => {
    const nav = tabs.navRef.current;
    if (!nav) return;
    const overflows = () => nav.scrollWidth > nav.clientWidth;
    const fit = () => {
      delete nav.dataset.compact;
      if (!overflows()) return;
      nav.dataset.compact = "tight";
    };
    // 被裁切时在对应一侧显示渐隐，提示还能横向滚动。
    const updateFade = () => {
      const max = nav.scrollWidth - nav.clientWidth;
      nav.dataset.fadeStart = max > 1 && nav.scrollLeft > 1 ? "true" : "false";
      nav.dataset.fadeEnd = max > 1 && nav.scrollLeft < max - 1 ? "true" : "false";
    };
    const measure = () => { fit(); updateFade(); };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    nav.addEventListener("scroll", updateFade, { passive: true });
    return () => { observer.disconnect(); nav.removeEventListener("scroll", updateFade); };
  }, [tabs.navRef, showVersionControl, locale]);

  const visible = TABS.filter(([key]) => key !== "versionControl" || showVersionControl);

  // 方向键只移动焦点（手动激活）：轨迹、使用统计会按需加载数据，不该随方向键反复触发；Enter / 空格选中。
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (current < 0) return;
    const last = buttons.length - 1;
    const next = event.key === "ArrowRight" ? (current >= last ? 0 : current + 1)
      : event.key === "ArrowLeft" ? (current <= 0 ? last : current - 1)
      : event.key === "Home" ? 0
      : event.key === "End" ? last
      : -1;
    if (next < 0) return;
    event.preventDefault();
    buttons[next]?.focus();
    buttons[next]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  return (
    <nav
      ref={tabs.navRef}
      className="conversation-view-tabs chat-view-tabs"
      role="tablist"
      aria-label={tr("会话视图", "Conversation view")}
      onPointerMove={tabs.onPointerMove}
      onPointerLeave={tabs.onPointerLeave}
      onKeyDown={onKeyDown}
    >
      {visible.map(([key, chinese, english]) => {
        const unavailable = isEmptyConversationView(key, emptyConversation);
        const reason = tr("发送第一条消息后可用", "Available after the first message");
        return (
          <button
            key={key}
            id={conversationTabId(idPrefix, key)}
            type="button"
            role="tab"
            data-tab-key={key}
            tabIndex={view === key ? 0 : -1}
            aria-selected={view === key}
            aria-controls={conversationPanelId(idPrefix, key)}
            aria-disabled={unavailable || undefined}
            aria-label={unavailable ? `${tr(chinese, english)} – ${reason}` : tr(chinese, english)}
            title={unavailable ? reason : tr(chinese, english)}
            ref={tabs.registerTab(key)}
            onClick={() => { if (!unavailable) onChange(key); }}
          >
            {tr(chinese, english)}
          </button>
        );
      })}
      {tabs.indicator}
    </nav>
  );
}
