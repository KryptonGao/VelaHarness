import { tr } from "../locale";
import { useSlidingTabIndicator } from "./useSlidingTabIndicator";

export type ConversationViewKey = "chat" | "trace" | "versionControl" | "usage" | "context" | "budget";

const TABS: ReadonlyArray<readonly [ConversationViewKey, string, string]> = [
  ["chat", "对话", "Conversation"],
  ["trace", "轨迹", "Trace"],
  ["versionControl", "版本控制", "Version Control"],
  ["usage", "使用统计", "Usage"],
  ["context", "上下文", "Context"],
  ["budget", "用量限制", "Usage limit"],
];

/** 尚无任何消息时没有内容可看的视图;用量限制是设置项,空对话也能用。 */
const NEEDS_MESSAGES: ReadonlySet<ConversationViewKey> = new Set(["trace", "usage", "context"]);

export function isEmptyConversationView(key: ConversationViewKey, emptyConversation: boolean) {
  return emptyConversation && NEEDS_MESSAGES.has(key);
}

interface ConversationViewTabsProps {
  view: ConversationViewKey;
  showVersionControl: boolean;
  /** 对话还没有消息:依赖消息的分页置灰,不可点击。 */
  emptyConversation?: boolean;
  onChange: (next: ConversationViewKey) => void;
}

/** 顶部会话视图选项卡:共享下划线跟随激活项滑动,悬停激活项时向两侧展开。 */
export function ConversationViewTabs({ view, showVersionControl, emptyConversation = false, onChange }: ConversationViewTabsProps) {
  const tabs = useSlidingTabIndicator({ activeKey: view });

  return (
    <nav
      ref={tabs.navRef}
      className="conversation-view-tabs chat-view-tabs"
      role="tablist"
      aria-label={tr("会话视图", "Conversation view")}
      onPointerMove={tabs.onPointerMove}
      onPointerLeave={tabs.onPointerLeave}
    >
      {TABS.filter(([key]) => key !== "versionControl" || showVersionControl).map(([key, chinese, english]) => {
        const unavailable = isEmptyConversationView(key, emptyConversation);
        return (
          <button
            key={key}
            type="button"
            role="tab"
            data-tab-key={key}
            aria-selected={view === key}
            aria-disabled={unavailable || undefined}
            title={unavailable ? tr("发送第一条消息后可用", "Available after the first message") : undefined}
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
