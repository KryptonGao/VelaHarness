import { useCallback, useEffect, useRef, useState } from "react";
import { globalPromptPreferenceKey, maxGlobalPromptLength } from "../../../system-prompt-preference";
import { uiStorage } from "../../ui-storage";
import { showToast } from "../../toast";
import type { SettingsCopy } from "../settings-copy";
import { SettingsBlock } from "./primitives";

// Keep a failed write available if the user leaves Settings and comes back.
let failedDraft: string | null = null;

export function GlobalPromptBlock({ text }: { text: SettingsCopy["agent"] }) {
  const [value, setValue] = useState<string | null>(() => {
    if (failedDraft !== null) return failedDraft;
    try { return uiStorage.getItem(globalPromptPreferenceKey) ?? ""; }
    catch { return null; }
  });
  const [saveFailed, setSaveFailed] = useState(failedDraft !== null);
  const pending = useRef<string | null>(failedDraft);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    const draft = pending.current;
    if (draft === null) return;
    try {
      if (draft.trim()) uiStorage.setItem(globalPromptPreferenceKey, draft);
      else uiStorage.removeItem(globalPromptPreferenceKey);
      pending.current = null;
      failedDraft = null;
      setSaveFailed(false);
      showToast(text.saved, { icon: "check" });
    } catch {
      failedDraft = draft;
      setSaveFailed(true);
    }
  }, [text.saved]);
  useEffect(() => save, [save]);

  return (
    <SettingsBlock id="global-prompt" title={text.globalPrompt} hint={text.globalPromptHint}>
      <textarea
        className="settings-textarea"
        aria-label={text.globalPrompt}
        value={value ?? ""}
        disabled={value === null}
        maxLength={maxGlobalPromptLength}
        placeholder={text.globalPromptPlaceholder}
        onChange={(event) => {
          const draft = event.target.value;
          pending.current = draft;
          setValue(draft);
          setSaveFailed(false);
          if (timer.current !== null) clearTimeout(timer.current);
          timer.current = setTimeout(save, 800);
        }}
        onBlur={save}
      />
      {value === null || saveFailed ? (
        <p className="settings-error" role="alert">{value === null ? text.loadError : text.globalPromptSaveError}</p>
      ) : (
        <p className="settings-note">{text.autosaveNote}</p>
      )}
    </SettingsBlock>
  );
}
