import { appLocales, localizeZh, type AskUserQuestionRequest, type ToolTrace } from "@vela/shared";
import { useId, useState } from "react";
import { tr } from "../locale";
import { useAttentionFocus } from "./attention-focus";
import { ToolDurationLabel, useToolExpanded } from "./ToolProcessContext";
import { foldRowId } from "./tool-fold-state";
import { Icon } from "./icons";

/** 工具记录里的回答行前缀是规范中文，但历史或本地化后的文本可能是任一语言，所以逐语言收集。 */
const ANSWER_PREFIXES = [...new Set([
  "用户回答：",
  "Your answer: ",
  ...appLocales.flatMap((locale) => [localizeZh(locale, "用户回答：", "Your answer: ")]),
])];

function answerOf(line: string | undefined): string | null {
  if (line === undefined) return null;
  const prefix = ANSWER_PREFIXES.find((candidate) => line.startsWith(candidate));
  return prefix === undefined ? null : line.slice(prefix.length);
}

/** 回答没送达（返回 false 或抛错）时，卡片恢复可选状态并提示重试；返回 void 视为成功。 */
export type QuestionReplyHandler = (id: string, answer: string | null) => void | boolean | Promise<boolean | void>;

/**
 * ask_user_question 工具的消息内卡片。
 * 等待回答时直接显示答题控件；结束后折叠为摘要，展开可查看原问题和最终回答。
 */
export function QuestionCard({
  tool,
  request,
  onReply,
  compact = false,
}: {
  tool: ToolTrace;
  request: AskUserQuestionRequest | null;
  onReply: QuestionReplyHandler;
  compact?: boolean;
}) {
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lines = (tool.activity?.body ?? "").split("\n").filter((line) => line.trim().length > 0);
  const question = request?.question ?? lines[0] ?? "…";
  const optionLines = request ? [] : lines.filter((line) => line.startsWith("·"));
  const interactive = tool.status === "running" && request !== null && !busy;
  // 等待回答时把焦点交给第一个选项（没有选项时是自定义输入）；用户正在输入时只朗读，不抢焦点。
  const card = useAttentionFocus<HTMLElement>(interactive, ".question-option, .question-custom-input");

  function reply(answer: string | null): void {
    if (!request || busy) return;
    setBusy(true);
    setError(null);
    const failed = () => {
      setBusy(false);
      setError(tr("回答没有送达，请重试或跳过", "Your answer was not delivered. Try again or skip."));
    };
    try {
      const result = onReply(request.id, answer);
      if (result === false) failed();
      else if (result instanceof Promise) result.then((ok) => { if (ok === false) failed(); }, failed);
    } catch {
      failed();
    }
  }

  function submitCustom(): void {
    const text = custom.trim();
    if (!text) return;
    reply(text);
  }

  if (tool.status !== "running") {
    const answer = answerOf(lines.find(line => answerOf(line) !== null));
    return <QuestionHistory tool={tool} compact={compact} question={question} answer={answer} />;
  }

  return (
    <article
      ref={card}
      className={`question-card is-${tool.status}${interactive ? " interactive" : ""}`}
      aria-label={tr("Agent 的提问", "Question from the agent")}
    >
      {request ? (
        <div className="visually-hidden" role="alert">{tr("Agent 需要你回答：", "The agent needs your answer: ")}{question}</div>
      ) : null}
      <div className="question-card-head">
        <span className="tool-card-icon" aria-hidden="true">
          <Icon name="question" size={14} />
        </span>
        <span className="tool-kind-label">{tr("提问", "Question")}</span>
        <span className="question-card-state">
          {busy ? tr("已选择，等待确认", "Selected, waiting for confirmation")
            : request ? tr("等待你的回答", "Waiting for your answer")
            : tr("等待回答", "Waiting for an answer")}
        </span>
        <span className="tool-spinner" role="status" aria-label={tr("等待回答", "Waiting for an answer")} />
      </div>
      <div className="question-card-q">{question}</div>
      {interactive && request ? (
        <>
          {request.options.length > 0 ? (
            <div className="question-card-options" role="group" aria-label={tr("回答选项", "Answer options")}>
              {request.options.map((option) => (
                <button
                  type="button"
                  className="question-option"
                  key={option.label}
                  title={option.description ?? option.label}
                  onClick={() => reply(option.label)}
                >
                  <span className="question-option-label">{option.label}</span>
                  {option.description ? (
                    <span className="question-option-desc">{option.description}</span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
          {request.allowFreeText ? (
            <div className="question-card-custom">
              <input
                className="question-custom-input"
                value={custom}
                placeholder={tr("自定义回答…", "Write a custom answer…")}
                aria-label={tr("自定义回答", "Custom answer")}
                onChange={(event) => setCustom(event.target.value)}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing || event.key === "Process") return;
                  if (event.key === "Enter") {
                    event.preventDefault();
                    submitCustom();
                  }
                }}
              />
              <button
                type="button"
                className="question-custom-send"
                disabled={!custom.trim()}
                onClick={submitCustom}
              >
                {tr("发送", "Send")}
              </button>
            </div>
          ) : null}
          {error ? <p className="question-card-error" role="alert">{error}</p> : null}
          <div className="question-card-skip">
            <button type="button" className="question-skip" onClick={() => reply(null)}>
              {tr("跳过这个问题", "Skip this question")}
            </button>
          </div>
        </>
      ) : (
        optionLines.map((line) => <div className="question-card-option-echo" key={line}>{line}</div>)
      )}
    </article>
  );
}

function QuestionHistory({ tool, compact, question, answer }: {
  tool: ToolTrace; compact: boolean; question: string; answer: string | null;
}) {
  const [open, setOpen] = useToolExpanded(foldRowId(tool.id), compact);
  const answerId = useId();
  return (
    <article className={`question-card question-history${compact ? " is-compact-history" : ""}${open ? " open" : ""}`}>
      <button type="button" className="question-history-toggle" aria-expanded={open} aria-controls={answerId}
        onClick={() => setOpen(value => !value)}>
        <span className="question-compact-icon" aria-hidden="true"><Icon name="question" size={14} /></span>
        <span className="question-card-q">{open ? question : tr("询问了1个问题", "Asked 1 question")}</span>
        <Icon name="chevron-right" size={12} className="question-history-chevron" />
        {compact && <ToolDurationLabel tool={tool} />}
      </button>
      <div id={answerId} className="tool-collapse" inert={!open}>
        <div className="tool-collapse-inner">
          <div className="question-compact-answer">
            <span className="question-compact-guide" aria-hidden="true" />
            <div className={`question-compact-answer-text${answer === null ? " is-empty" : ""}`}>
              {answer ?? (tool.status === "error" ? tr("问题没有回答", "Question was not answered") : tr("没有回答", "No answer"))}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
