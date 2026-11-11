import { tr, trf } from "../locale";
import type { ProviderError } from "./provider-error";

/** 把等待分钟数写成「2 小时 5 分钟」这样的短句；超过两天只写天数。 */
function waitText(minutes: number): string {
  if (minutes < 1) return tr("不到 1 分钟", "less than a minute");
  if (minutes < 60) return trf("{0} 分钟", "{0} min", minutes);
  const hours = Math.floor(minutes / 60);
  if (hours >= 48) return trf("{0} 天", "{0} days", Math.round(hours / 24));
  const rest = minutes % 60;
  return rest ? trf("{0} 小时 {1} 分钟", "{0} h {1} min", hours, rest) : trf("{0} 小时", "{0} h", hours);
}

function copyFor(error: ProviderError, raw: string): { title: string; body: string } {
  if (error.kind === "usage-limit") {
    return {
      title: tr("已达到用量上限", "Usage limit reached"),
      body: error.retryMinutes !== null
        ? trf("约 {0}后额度重置，之后可以继续。也可以先换一个模型。", "Your quota resets in about {0}. You can also switch to another model.", waitText(error.retryMinutes))
        : tr("额度重置后可以继续，也可以先换一个模型。", "Continue once your quota resets, or switch to another model."),
    };
  }
  if (error.kind === "rate-limit") {
    return {
      title: tr("请求太频繁", "Too many requests"),
      body: error.retryMinutes !== null
        ? trf("请等待约 {0}后再发送。", "Wait about {0}, then send again.", waitText(error.retryMinutes))
        : tr("请稍等片刻再发送。", "Wait a moment, then send again."),
    };
  }
  if (error.kind === "overloaded") {
    return {
      title: tr("模型服务繁忙", "The model is busy"),
      body: tr("这个模型暂时没有足够算力。稍后再试，或先换一个模型。", "This model is out of capacity right now. Try again shortly, or switch to another model."),
    };
  }
  if (error.kind === "auth") {
    return {
      title: tr("模型服务拒绝了请求", "Request was rejected"),
      body: tr("请检查这个模型的 API 密钥或账号权限。", "Check the API key or account access for this model."),
    };
  }
  if (error.kind === "context") {
    return {
      title: tr("对话太长", "Conversation is too long"),
      body: tr("超出了模型的上下文长度。压缩上下文，或在新对话里继续。", "This exceeds the model's context length. Compact the context, or continue in a new chat."),
    };
  }
  return {
    title: tr("请求失败", "Request failed"),
    body: error.message ?? raw,
  };
}

/** 对话流里的模型服务限额提示，替代输入框上方的一行红字。 */
export function ProviderErrorCard({ error, raw }: { error: ProviderError; raw: string }) {
  const { title, body } = copyFor(error, raw);
  const meta = [error.source, error.plan].filter(Boolean).join(" · ");
  return (
    <aside className="provider-error-card" data-kind={error.kind} role="alert" title={raw}>
      <span className="provider-error-icon" aria-hidden="true">
        {error.kind === "usage-limit" ? (
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12.5a6.2 6.2 0 1 1 12 0" /><path d="M9 12.5 12 7.5" /><circle cx="9" cy="12.5" r="0.6" fill="currentColor" />
          </svg>
        ) : error.kind === "rate-limit" ? (
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="9" cy="9" r="6.2" /><path d="M9 5.5V9l2.3 1.4" />
          </svg>
        ) : error.kind === "overloaded" ? (
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2.5 11.5h2l1.5-5 3 8 2-6 1.2 3h3.3" />
          </svg>
        ) : error.kind === "auth" ? (
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="6.5" cy="11.5" r="3" /><path d="M8.7 9.3 14.5 3.5M12.5 5.5l1.8 1.8" />
          </svg>
        ) : error.kind === "context" ? (
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 5h12M3 9h12M3 13h7" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <circle cx="9" cy="9" r="6.2" /><path d="M9 5.6V9.4" /><circle cx="9" cy="12" r="0.5" fill="currentColor" />
          </svg>
        )}
      </span>
      <div className="provider-error-text">
        <div className="provider-error-head">
          <strong>{title}</strong>
          {meta ? <span className="provider-error-meta">{meta}</span> : null}
        </div>
        <p>{body}</p>
      </div>
    </aside>
  );
}
