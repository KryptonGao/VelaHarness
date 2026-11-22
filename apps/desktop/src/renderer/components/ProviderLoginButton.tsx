import type { AuthMethodType } from "@vela/shared";
import { useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { SettingsCopy } from "./settings-copy";

interface ProviderLoginButtonProps {
  providerId: string;
  builtinId?: string;
  method: AuthMethodType;
  className: string;
  children: ReactNode;
  copy: SettingsCopy["models"];
  onLogin: (providerId: string, method: AuthMethodType) => void;
}

export function ProviderLoginButton({ providerId, builtinId, method, className, children, copy, onLogin }: ProviderLoginButtonProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const detailId = useId();
  const offerChoice = (builtinId ?? providerId) === "openai" && method === "oauth";

  function choose(id: string) {
    dialog.current?.close();
    onLogin(id, "oauth");
  }

  return <>
    <button type="button" className={className} aria-haspopup={offerChoice ? "dialog" : undefined}
      onClick={() => offerChoice ? dialog.current?.showModal() : onLogin(providerId, method)}>
      {children}
    </button>
    {offerChoice && createPortal(
      <dialog ref={dialog} className="provider-login-choice" aria-labelledby={titleId} aria-describedby={detailId}
        onKeyDown={event => event.stopPropagation()}>
        <header className="sheet-header">
          <h2 id={titleId}>{copy.openaiLoginTitle}</h2>
          <button type="button" className="sheet-close" onClick={() => dialog.current?.close()}>{copy.cancel}</button>
        </header>
        <p id={detailId}>{copy.openaiQuotaHint}</p>
        <footer className="sheet-footer">
          <button type="button" className="sheet-close" onClick={() => choose(providerId)}>{copy.continueChatgpt}</button>
          <button type="button" className="primary-btn" onClick={() => choose("openai-codex")}>{copy.useCodexOauth}</button>
        </footer>
      </dialog>, document.body)}
  </>;
}
