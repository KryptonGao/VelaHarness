import { isAgentBusy, type AgentInfo } from "@vela/shared";
import { forwardRef, useLayoutEffect, useRef, useState } from "react";
import type { SendButtonIcon } from "../hooks/usePreferences";
import { useComposerLayout } from "../hooks/useComposerLayout";
import { localizeError, tr } from "../locale";
import { ComposerActions } from "./Composer";
import { serializeEditor, setEditorText } from "./composer/skill-editor";

/** 上限由样式表决定（随字号和窗口高度变化）；读不到时退回 140px。 */
function maxInputHeight(input: HTMLElement): number {
  const value = Number.parseFloat(getComputedStyle(input).maxHeight);
  return Number.isFinite(value) ? value : 140;
}

/**
 * 右侧 Agent Pane 底部的输入框：沿用主输入框的外壳和样式类，所以 classic / calm / capsule 布局、
 * 发送按钮图标等全局设置自动生效；只保留纯文本发送，没有模型、模式、附件等主对话专属控件。
 * 子代理正在跑时消息排在当前回合之后处理，所以这里始终是「发送」，不会出现停止按钮（停止在面板顶部）。
 */
export const AgentComposer = forwardRef<HTMLDivElement, {
  agent: AgentInfo;
  sendButtonIcon?: SendButtonIcon;
  onSend: (agentId: string, text: string) => Promise<void>;
}>(function AgentComposer({ agent, sendButtonIcon = "paper-plane", onSend }, ref) {
  const layout = useComposerLayout();
  const inputRef = useRef<HTMLDivElement>(null);
  const submitting = useRef(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const busy = isAgentBusy(agent.status);
  // 没有保存完整会话的历史子代理重建后是空上下文，不接收消息。
  const unavailable = agent.historyIncomplete === true;
  const prompt = value.trim();
  const canSend = !unavailable && prompt.length > 0;

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const fit = () => {
      input.style.height = "auto";
      input.style.height = `${Math.min(input.scrollHeight, maxInputHeight(input))}px`;
    };
    fit();
    let width = input.getBoundingClientRect().width;
    const resize = new ResizeObserver(() => {
      const next = input.getBoundingClientRect().width;
      if (Math.abs(next - width) < 1) return;
      width = next;
      fit();
    });
    resize.observe(input);
    // 输入法组字会直接改 DOM 而不一定带来 value 变化，换行那一刻也要跟着撑高。
    const mutation = new MutationObserver(fit);
    mutation.observe(input, { childList: true, characterData: true, subtree: true });
    return () => { resize.disconnect(); mutation.disconnect(); };
  }, [value]);

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
    setError(null);
    try {
      await onSend(agent.id, text);
    } catch (caught) {
      // 没发出去就把草稿放回去，用户已经开始写新内容就不覆盖。
      setError(localizeError(caught instanceof Error ? caught.message : tr("发送失败", "Failed to send")));
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

  const entry = (
    <div className="composer-entry">
      <div
        ref={inputRef}
        className="input-textarea rich-input"
        data-placeholder={unavailable
          ? tr("历史子代理无法继续对话", "This historical subagent can't continue")
          : tr("给这个子代理发消息", "Message this subagent")}
        data-empty={!prompt}
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
    <ComposerActions sendButtonIcon={sendButtonIcon} streaming={false} sendHint={sendHint} steerHint=""
      canQueue={false} disabled={!canSend} onSteer={() => undefined} onAbort={async () => undefined} />
  );
  const status = error ? (
    <div className="composer-status-bar">
      <span className="composer-status-notice" role="alert" title={error}>{error}</span>
    </div>
  ) : null;
  const hint = busy && !unavailable ? (
    <p className="composer-queue-hint">{tr("子代理正在运行，消息会在当前回合结束后处理", "The subagent is running. Your message is handled after its current turn")}</p>
  ) : null;

  return (
    <div className="chat-dock-wrapper" ref={ref}>
      <form
        className={`floating-input-card${layout === "capsule" ? " layout-capsule" : ""}`}
        onSubmit={(event) => { event.preventDefault(); void submit(); }}
      >
        {layout === "capsule" ? (
          <>
            {status}
            {hint}
            <div className="composer-capsule">
              <div className="composer-capsule-main">
                {entry}
                {actions}
              </div>
            </div>
          </>
        ) : (
          <>
            {status}
            {hint}
            {entry}
            <div className="dock-controls-row">
              <div className="dock-controls-left" />
              <div className="dock-controls-right">{actions}</div>
            </div>
          </>
        )}
      </form>
    </div>
  );
});
