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
      <dialog ref={dialog} className="modal provider-login-choice" aria-labelledby={titleId} aria-describedby={detailId}
        onKeyDown={event => event.stopPropagation()}>
        <header className="modal-head">
          <h2 id={titleId}>{copy.openaiLoginTitle}</h2>
        </header>
        <div className="modal-body">
          <p id={detailId}>{copy.openaiQuotaHint}</p>
        </div>
        <footer className="modal-foot">
          <button type="button" className="modal-btn" onClick={() => dialog.current?.close()}>{copy.cancel}</button>
          <button type="button" className="modal-btn" onClick={() => choose(providerId)}>{copy.continueChatgpt}</button>
          <button type="button" className="modal-btn modal-btn-primary" onClick={() => choose("openai-codex")}>{copy.useCodexOauth}</button>
        </footer>
      </dialog>, document.body)}
  </>;
}
