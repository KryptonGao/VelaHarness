/**
 * 设置页「语音」：朗读（TTS）和语音输入（ASR）共用的 DeepSeek API 密钥。密钥只写入，保存后只显示「已保存」；
 * 未保存密钥时，回复下方不显示朗读按钮，输入框也不显示麦克风按钮。
 */
import { useState } from "react";
import type { SpeechVoice } from "@vela/shared";
import { speechErrorText, setSpeechApiKey, setSpeechVoice, useSpeechState, useSpeechVoice } from "../../hooks/useSpeech";
import { tr } from "../../locale";
import { Segmented, SettingsBlock } from "./primitives";
import "../../web-tools.css";

export function SpeechSettings() {
  const speech = useSpeechState();
  const voice = useSpeechVoice();
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
  const title = tr("语音", "Speech");
  const voices: { id: SpeechVoice; label: string }[] = [
    { id: "stella", label: tr("海星（女声）", "Stella (female)") },
    { id: "tide", label: tr("暗潮（男声）", "Tide (male)") },
  ];
  return (
    <>
    <SettingsBlock
      title={title}
      hint={tr(
        "使用 DeepSeek 语音合成朗读最终回复，并用语音识别做语音输入。填写 DeepSeek API 密钥后，回复下方会出现朗读按钮，发送按钮左边会出现麦克风按钮。",
        "Reads final replies aloud with DeepSeek speech synthesis and powers voice input with DeepSeek speech recognition. Add a DeepSeek API key and a read-aloud button appears below replies, with a microphone button next to Send.",
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
    <SettingsBlock title={tr("朗读音色", "Voice")} layout="inline">
      <Segmented label={tr("朗读音色", "Voice")} value={voice} options={voices} onChange={setSpeechVoice} />
    </SettingsBlock>
    </>
  );
}
