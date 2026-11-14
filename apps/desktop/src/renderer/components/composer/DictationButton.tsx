import { tr } from "../../locale";
import type { DictationStatus } from "../../hooks/useDictation";
import { MicIcon } from "../icons";

/** 发送按钮左边的语音输入：点一下开始录音，再点一下结束并识别；识别期间点击可取消。 */
export function DictationButton({ status, disabled, onToggle }: {
  status: DictationStatus;
  disabled: boolean;
  onToggle: () => void;
}) {
  const label = status === "recording"
    ? tr("结束录音并识别", "Stop recording")
    : status === "transcribing"
      ? tr("正在识别，点击取消", "Transcribing. Click to cancel")
      : tr("语音输入", "Voice input");
  return (
    <button
      className={`composer-dictation-btn${status === "recording" ? " is-recording" : ""}${status === "transcribing" ? " is-transcribing" : ""}`}
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={status === "recording"}
      disabled={disabled && status === "idle"}
      onClick={onToggle}
    >
      {status === "recording" ? <span className="stop-square" /> : status === "transcribing" ? <span className="composer-dictation-spinner" /> : <MicIcon />}
    </button>
  );
}
