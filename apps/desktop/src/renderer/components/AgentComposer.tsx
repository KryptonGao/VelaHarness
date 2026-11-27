import { isAgentBusy, type AgentInfo } from "@vela/shared";
import { forwardRef, useRef, useState, type ReactNode } from "react";
import { tr } from "../locale";
import { showToast } from "../toast";
import { ComposerActions } from "./Composer";
import { serializeEditor, setEditorText } from "./composer/skill-editor";

/**
 * 右侧 Agent Pane 底部沿用主对话的胶囊输入框，仅支持纯文本发送。
 * 子代理正在跑时消息排在当前回合之后处理，所以这里始终是「发送」，不会出现停止按钮（停止在面板顶部）。
 */
export const AgentComposer = forwardRef<HTMLDivElement, {
  agent: AgentInfo;
  changeSummary?: ReactNode;
  onSend: (agentId: string, text: string) => Promise<void>;
}>(function AgentComposer({ agent, changeSummary, onSend }, ref) {
  const inputRef = useRef<HTMLDivElement>(null);
  const submitting = useRef(false);
  const [value, setValue] = useState("");
  const busy = isAgentBusy(agent.status);
  // 没有保存完整会话的历史子代理重建后是空上下文，不接收消息。
  const unavailable = agent.historyIncomplete === true;
  const prompt = value.trim();
  const canSend = !unavailable && prompt.length > 0;

  function sync(): void {
    const root = inputRef.current;
    if (root) setValue(serializeEditor(root));
  }

  async function submit(): Promise<void> {
    const root = inputRef.current;
    if (!root || submitting.current || unavailable) return;
    const text = serializeEditor(root).trim();
    if (!text) return;
    submitting.current = true;
    root.replaceChildren();
    setValue("");
    try {
      await onSend(agent.id, text);
    } catch (caught) {
      // 没发出去就把草稿放回去，用户已经开始写新内容就不覆盖。
      showToast(caught instanceof Error ? caught.message : tr("发送失败", "Failed to send"), { kind: "error" });
      if (!serializeEditor(root).trim()) { setEditorText(root, text); setValue(text); }
    } finally {
      submitting.current = false;
    }
  }

  const sendHint = unavailable
    ? tr("这个历史子代理没有保存完整会话", "This historical subagent has no saved session")
    : !prompt
      ? tr("输入内容后发送", "Enter a message to send")
      : busy ? tr("排队发送 (Enter)", "Queue (Enter)") : tr("发送 (Enter)", "Send (Enter)");

  const placeholder = unavailable
    ? tr("历史子代理无法继续对话", "This historical subagent can't continue")
    : busy
      ? tr("子代理正在运行，消息会在当前回合结束后处理", "The subagent is running. Your message is handled after its current turn")
      : tr("给这个子代理发消息", "Message this subagent");

  const entry = (
    <div className="composer-entry">
      <div
        ref={inputRef}
        className="input-textarea rich-input"
        data-placeholder={placeholder}
        aria-placeholder={placeholder}
        title={!value && busy && !unavailable ? placeholder : undefined}
        data-empty={!value}
        role="textbox"
        aria-multiline="true"
        aria-label={tr("给子代理发消息", "Message the subagent")}
        aria-disabled={unavailable}
        contentEditable={!unavailable}
        suppressContentEditableWarning
        spellCheck
        onInput={sync}
        onPaste={(event) => {
          // 输入框是 contenteditable，默认会带着样式粘贴；这里只收纯文本。
          const text = event.clipboardData.getData("text/plain");
          event.preventDefault();
          if (text) document.execCommand("insertText", false, text);
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.key === "Process") return;
          if (event.key !== "Enter") return;
          event.preventDefault();
          if (event.shiftKey) document.execCommand("insertLineBreak");
          else void submit();
        }}
      />
    </div>
  );
  const actions = (
    <ComposerActions streaming={false} sendHint={sendHint}
      canQueue={false} disabled={!canSend} onAbort={async () => undefined} />
  );

  return (
    <div className="chat-dock-wrapper" ref={ref}>
      {changeSummary}
      <form
        className="floating-input-card layout-capsule"
        onSubmit={(event) => { event.preventDefault(); void submit(); }}
      >
        <div className="composer-capsule">
          <div className="composer-capsule-main">
            {entry}
            {actions}
          </div>
        </div>
      </form>
    </div>
  );
});
