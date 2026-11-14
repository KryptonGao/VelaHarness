import { useCallback, useEffect, useRef, useState } from "react";
import { dictationLimits } from "@vela/shared";
import { encodeWav, toPcm16 } from "../dictation-audio";
import { tr } from "../locale";
import { createLogger } from "../logger";
import { speechErrorText } from "./useSpeech";

const log = createLogger("dictation");

export type DictationStatus = "idle" | "starting" | "recording" | "transcribing";

/** 短于这个时长的录音当作误触，不发送识别。 */
const minDurationMs = 400;

interface Recording {
  stream: MediaStream;
  context: AudioContext;
  source: MediaStreamAudioSourceNode;
  processor: ScriptProcessorNode;
  chunks: Float32Array[];
  startedAt: number;
  timer: number;
}

function microphoneErrorText(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return tr("没有麦克风权限，请在系统设置中允许 Vela 使用麦克风", "Microphone access is blocked. Allow Vela to use the microphone in System Settings.");
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") return tr("没有找到麦克风", "No microphone found");
  return tr("无法打开麦克风", "Can't open the microphone");
}

/**
 * 语音输入：录音 → 16 kHz 单声道 WAV → 主进程识别并整理 → onText。
 * 录音在渲染进程里做，因为只有这里能访问麦克风；音频不落盘。
 */
export function useDictation(onText: (text: string) => void) {
  const [status, setStatus] = useState<DictationStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const recording = useRef<Recording | null>(null);
  const statusRef = useRef<DictationStatus>("idle");
  // 每次开始/取消都换一个编号，过期的异步结果据此丢弃。
  const attempt = useRef(0);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  const update = useCallback((next: DictationStatus) => { statusRef.current = next; setStatus(next); }, []);

  const release = useCallback((): Recording | null => {
    const current = recording.current;
    if (!current) return null;
    recording.current = null;
    window.clearTimeout(current.timer);
    current.processor.onaudioprocess = null;
    current.processor.disconnect();
    current.source.disconnect();
    for (const track of current.stream.getTracks()) track.stop();
    void current.context.close().catch(() => undefined);
    return current;
  }, []);

  const cancel = useCallback(() => {
    attempt.current += 1;
    release();
    update("idle");
  }, [release, update]);

  const stop = useCallback(async () => {
    if (statusRef.current !== "recording") return;
    const mine = attempt.current;
    const finished = release();
    if (!finished) { update("idle"); return; }
    const elapsed = Date.now() - finished.startedAt;
    const pcm = toPcm16(finished.chunks, finished.context.sampleRate);
    if (elapsed < minDurationMs || pcm.length === 0) {
      update("idle");
      setError(tr("录音太短", "That was too short"));
      return;
    }
    const speech = window.vela?.speech;
    if (!speech) { update("idle"); setError(speechErrorText("failed")); return; }
    update("transcribing");
    try {
      const result = await speech.transcribe({ audio: encodeWav(pcm) });
      if (mine !== attempt.current) return;
      if (!result.ok) setError(dictationErrorText(result.code));
      else onTextRef.current(result.value.text);
    } catch (caught) {
      log.warn("dictation failed", caught);
      if (mine === attempt.current) setError(speechErrorText("failed"));
    } finally {
      if (mine === attempt.current) update("idle");
    }
  }, [release, update]);

  const start = useCallback(async () => {
    if (statusRef.current !== "idle") return;
    if (!navigator.mediaDevices?.getUserMedia) { setError(tr("无法打开麦克风", "Can't open the microphone")); return; }
    attempt.current += 1;
    const mine = attempt.current;
    setError(null);
    update("starting");
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      // 等权限弹窗期间用户可能已经取消。
      if (mine !== attempt.current) { for (const track of stream.getTracks()) track.stop(); return; }
      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      // ScriptProcessor 已被弃用，但不需要额外的 worklet 文件，在 Electron 里稳定可用。
      const processor = context.createScriptProcessor(4096, 1, 1);
      const chunks: Float32Array[] = [];
      processor.onaudioprocess = event => { chunks.push(new Float32Array(event.inputBuffer.getChannelData(0))); };
      source.connect(processor);
      processor.connect(context.destination);
      recording.current = {
        stream, context, source, processor, chunks,
        startedAt: Date.now(),
        timer: window.setTimeout(() => void stop(), dictationLimits.durationMsMax),
      };
      update("recording");
    } catch (caught) {
      log.warn("failed to start dictation", caught);
      if (stream) for (const track of stream.getTracks()) track.stop();
      if (mine === attempt.current) { update("idle"); setError(microphoneErrorText(caught)); }
    }
  }, [stop, update]);

  // 失败提示几秒后自动消失。
  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(null), 4000);
    return () => window.clearTimeout(timer);
  }, [error]);

  // 卸载（切换会话、关闭面板）时放掉麦克风。
  useEffect(() => () => { attempt.current += 1; release(); }, [release]);

  return { status, error, start, stop, cancel };
}

function dictationErrorText(code: Parameters<typeof speechErrorText>[0]): string {
  switch (code) {
    case "no-key": return tr("还没有配置语音输入的 API 密钥", "No API key is set for voice input");
    case "auth": return tr("语音输入的 API 密钥无效或没有权限", "The voice input API key is invalid or lacks access");
    case "rejected": return tr("这段录音无法识别", "This recording can't be recognized");
    case "busy": return tr("语音识别服务繁忙，请稍后再试", "The speech recognition service is busy. Try again later.");
    case "timeout": return tr("语音识别超时", "Speech recognition timed out");
    case "network": return tr("无法连接语音识别服务", "Can't reach the speech recognition service");
    case "no-speech": return tr("没有听清，请再说一次", "Didn't catch that. Try again.");
    default: return tr("语音识别失败", "Speech recognition failed");
  }
}
