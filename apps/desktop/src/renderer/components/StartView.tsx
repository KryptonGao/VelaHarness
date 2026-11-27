import { useState, type ReactNode } from "react";
import { normalizeBrowserAddress } from "../../browser-policy";
import { tr } from "../locale";
import { Icon } from "./icons";
import { conversationDetailKeys, conversationDetails, isEmptyConversationView, type ConversationDetail } from "./conversation-detail";

/** 起始页入口;宿主据此打开对应标签页。 */
export type StartTabAction = "chat" | "side-chat" | "changes" | "terminal" | "files" | "background" | "agent-directory" | ConversationDetail;

function StartOption({
  icon,
  title,
  hint,
  disabled = false,
  onSelect,
}: {
  icon: ReactNode;
  title: string;
  /** 仅作悬停提示(如入口不可用的原因),不在卡片上显示。 */
  hint?: string;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className="start-option"
      disabled={disabled}
      onClick={onSelect}
      title={hint}
    >
      <span className="start-option-icon" aria-hidden="true">{icon}</span>
      <span className="start-option-title">{title}</span>
    </button>
  );
}

/**
 * 新标签页的起始页:集中展示工作面板入口。
 * 选中后由宿主把当前起始标签替换成对应内容。
 */
export function StartView({
  gitAvailable,
  conversationWorkbenchTabs = false,
  emptyConversation = false,
  onAction,
  onBrowse,
  pending = false,
}: {
  gitAvailable: boolean;
  conversationWorkbenchTabs?: boolean;
  emptyConversation?: boolean;
  onAction: (action: StartTabAction) => void;
  /** 地址栏回车:宿主把当前起始标签换成打开该网址的浏览器标签。 */
  onBrowse: (url: string) => void;
  pending?: boolean;
}) {
  const [address, setAddress] = useState("");
  const [invalid, setInvalid] = useState(false);
  const browse = () => {
    if (pending) return;
    const url = normalizeBrowserAddress(address);
    if (!url) { setInvalid(true); return; }
    onBrowse(url);
  };
  return (
    <div className="start-view">
      <div className="start-view-inner">
        <div className="start-view-header">
          <h2>{tr("新标签页", "New tab")}</h2>
          <p>{tr("选择要在这个标签里打开的内容", "Pick what to open in this tab")}</p>
        </div>
        <form className="start-address-form" onSubmit={(event) => { event.preventDefault(); browse(); }}>
          <span className="start-address-icon" aria-hidden="true"><Icon name="globe" size={16} /></span>
          <input
            className="start-address"
            aria-label={tr("网页地址", "Web address")}
            placeholder={tr("输入网址", "Enter a URL")}
            value={address}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={invalid || undefined}
            onChange={(event) => { setAddress(event.target.value); setInvalid(false); }}
          />
        </form>
        {invalid ? <p className="start-error" role="alert">{tr("请输入有效的 HTTP 或 HTTPS 网址", "Enter a valid HTTP or HTTPS address")}</p> : null}
        {conversationWorkbenchTabs && <fieldset className="start-options start-conversation-options" disabled={pending}
          aria-label={tr("会话视图", "Conversation view")}>
          {conversationDetailKeys.map(key => {
            const detail = conversationDetails[key];
            const disabled = isEmptyConversationView(key, emptyConversation);
            return <StartOption key={key} icon={<Icon name={detail.icon} size={18} />} title={detail.label()}
              disabled={disabled} hint={disabled ? tr("发送第一条消息后可用", "Available after the first message") : undefined}
              onSelect={() => onAction(key)} />;
          })}
        </fieldset>}
        <fieldset className="start-options" disabled={pending} aria-busy={pending}>
          <StartOption
            icon={<Icon name="subagent" size={18} />}
            title={tr("子代理目录", "Subagent directory")}
            onSelect={() => onAction("agent-directory")}
          />
          <StartOption
            icon={<Icon name="sparkles" size={18} />}
            title={tr("聊天", "Chat")}
            onSelect={() => onAction("side-chat")}
          />
          <StartOption
            icon={<Icon name="diff" size={18} />}
            title={tr("变更", "Changes")}
            hint={gitAvailable ? undefined : tr("当前工作区不是 Git 仓库", "The current workspace is not a Git repository")}
            disabled={!gitAvailable}
            onSelect={() => onAction("changes")}
          />
          <StartOption
            icon={<Icon name="terminal" size={18} />}
            title={tr("终端", "Terminal")}
            onSelect={() => onAction("terminal")}
          />
          <StartOption
            icon={<Icon name="list" size={18} />}
            title={tr("后台任务", "Background tasks")}
            onSelect={() => onAction("background")}
          />
          <StartOption
            icon={<Icon name="folder" size={18} />}
            title={tr("文件预览", "File preview")}
            onSelect={() => onAction("files")}
          />
        </fieldset>
      </div>
    </div>
  );
}
