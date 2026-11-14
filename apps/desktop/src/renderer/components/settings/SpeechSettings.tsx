/**
 * 设置页「朗读」：DeepSeek TTS 的 API 密钥。密钥只写入，保存后只显示「已保存」；
 * 未保存密钥时，回复下方不显示朗读按钮。
 */
import { useState } from "react";
import { speechErrorText, setSpeechApiKey, useSpeechState } from "../../hooks/useSpeech";
import { tr } from "../../locale";
import { SettingsBlock } from "./primitives";
import "../../web-tools.css";

export function SpeechSettings() {
  const speech = useSpeechState();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(value: string | null): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await setSpeechApiKey(value);
      if (!result.ok) setError(result.code === "invalid" ? tr("密钥格式不正确", "That key doesn't look right") : speechErrorText(result.code));
      else setKey("");
    } catch {
      setError(speechErrorText("failed"));
    } finally {
      setBusy(false);
    }
  }

  const disabled = busy || !speech.keysAvailable;
  const title = tr("朗读", "Read aloud");
  return (
    <SettingsBlock
      title={title}
      hint={tr(
        "使用 DeepSeek 语音合成朗读最终回复。填写 DeepSeek API 密钥后，回复下方会出现朗读按钮。",
        "Reads the final reply aloud with DeepSeek speech synthesis. Add a DeepSeek API key and a read-aloud button appears below replies.",
      )}
    >
      <form className="web-tools-key-row" onSubmit={(event) => { event.preventDefault(); const value = key.trim(); if (value) void save(value); }}>
        <input
          type="password"
          aria-label={tr("DeepSeek API 密钥", "DeepSeek API key")}
          value={key}
          placeholder={speech.configured ? tr("已保存，输入新密钥可替换", "Saved. Enter a new key to replace it") : tr("DeepSeek API 密钥", "DeepSeek API key")}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          onChange={(event) => setKey(event.target.value)}
        />
        <button className="settings-secondary" type="submit" disabled={disabled || !key.trim()}>
          {speech.configured ? tr("替换", "Replace") : tr("保存", "Save")}
        </button>
        {speech.configured ? (
          <button className="settings-secondary settings-danger" type="button" disabled={disabled} onClick={() => void save(null)}>
            {tr("移除", "Remove")}
          </button>
        ) : null}
      </form>
      {!speech.keysAvailable ? <p className="settings-error" role="alert">{tr("系统的安全存储不可用，无法保存密钥。", "Secure storage is unavailable, so the key can't be saved.")}</p> : null}
      {error ? <p className="settings-error" role="alert">{error}</p> : null}
    </SettingsBlock>
  );
}
