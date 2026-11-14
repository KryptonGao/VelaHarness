import { useEffect, useSyncExternalStore } from "react";
import { defaultSpeechVoice, isSpeechVoice, splitSpeechText, type SpeechFailureCode, type SpeechResult, type SpeechState, type SpeechVoice } from "@vela/shared";
import { tr } from "../locale";
import { createLogger } from "../logger";
import { uiStorage } from "../ui-storage";
import { readStoredState } from "./useStoredState";

const log = createLogger("speech");

/** 朗读（DeepSeek TTS）的配置状态与播放器。未配置密钥时界面不显示朗读按钮。 */
interface SpeechStore {
  loaded: boolean;
  state: SpeechState;
}
let store: SpeechStore = { loaded: false, state: { configured: false, keysAvailable: true } };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

function api() {
  return typeof window === "undefined" ? undefined : window.vela?.speech;
}

export function speechErrorText(code: SpeechFailureCode): string {
  switch (code) {
    case "no-key": return tr("还没有配置朗读的 API 密钥", "No API key is set for reading aloud");
    case "auth": return tr("朗读的 API 密钥无效或没有权限", "The read-aloud API key is invalid or lacks access");
    case "rejected": return tr("这段文字无法朗读", "This text can't be read aloud");
    case "busy": return tr("朗读服务繁忙，请稍后再试", "The read-aloud service is busy. Try again later.");
    case "timeout": return tr("朗读超时", "Reading aloud timed out");
    case "network": return tr("无法连接朗读服务", "Can't reach the read-aloud service");
    case "invalid": return tr("没有可朗读的文字", "There is nothing to read aloud");
    case "no-speech": return tr("没有听清，请再说一次", "Didn't catch that. Try again.");
    default: return tr("朗读失败", "Reading aloud failed");
  }
}

function adopt(result: SpeechResult<SpeechState>): SpeechResult<SpeechState> {
  if (result.ok) { store = { loaded: true, state: result.value }; emit(); }
  return result;
}

export async function refreshSpeechState(): Promise<void> {
  const speech = api();
  if (!speech) return;
  try { adopt(await speech.getState()); }
  catch (error) { log.warn("failed to load speech state", error); }
}

export async function setSpeechApiKey(apiKey: string | null): Promise<SpeechResult<SpeechState>> {
  const speech = api();
  if (!speech) return { ok: false, code: "failed", message: "" };
  const result = adopt(await speech.setApiKey({ apiKey }));
  if (result.ok && !result.value.configured) stopSpeaking();
  return result;
}

export function useSpeechState(): SpeechState & { loaded: boolean } {
  useEffect(() => { if (!store.loaded) void refreshSpeechState(); }, []);
  const current = useSyncExternalStore(subscribe, () => store);
  return { ...current.state, loaded: current.loaded };
}

// ---- 音色 ----

const voiceKey = "vela.speechVoice";
let voice: SpeechVoice = readStoredState<SpeechVoice>(voiceKey, defaultSpeechVoice, isSpeechVoice);
const voiceListeners = new Set<() => void>();

export function setSpeechVoice(next: SpeechVoice): void {
  voice = next;
  try { uiStorage.setItem(voiceKey, JSON.stringify(next)); }
  catch (error) { log.error(`failed to save UI preference ${voiceKey}`, error); }
  voiceListeners.forEach(listener => listener());
}

const currentVoice = () => voice;

export function useSpeechVoice(): SpeechVoice {
  return useSyncExternalStore(
    listener => { voiceListeners.add(listener); return () => { voiceListeners.delete(listener); }; },
    () => voice,
  );
}

// ---- 播放 ----

export interface SpeechPlayback {
  /** 正在朗读的回复；同一时刻只有一条。 */
  id: string;
  status: "loading" | "playing";
}
let playback: SpeechPlayback | null = null;
const playbackListeners = new Set<() => void>();
const setPlayback = (next: SpeechPlayback | null) => { playback = next; playbackListeners.forEach(listener => listener()); };

export function useSpeechPlayback(): SpeechPlayback | null {
  return useSyncExternalStore(
    listener => { playbackListeners.add(listener); return () => { playbackListeners.delete(listener); }; },
    () => playback,
  );
}

let session = 0;
let current: { audio: HTMLAudioElement; url: string; finish: () => void } | null = null;

export function stopSpeaking(): void {
  session += 1;
  if (current) {
    const { audio, url, finish } = current;
    current = null;
    audio.pause();
    URL.revokeObjectURL(url);
    finish();
  }
  setPlayback(null);
}

function playBytes(bytes: Uint8Array, mine: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "audio/wav" }));
    const audio = new Audio(url);
    const finish = () => {
      if (current?.audio === audio) { current = null; URL.revokeObjectURL(url); }
      resolve();
    };
    current = { audio, url, finish };
    audio.onended = finish;
    audio.onerror = () => {
      if (current?.audio === audio) { current = null; URL.revokeObjectURL(url); }
      reject(new Error("audio playback failed"));
    };
    if (mine !== session) { finish(); return; }
    audio.play().catch(error => {
      if (current?.audio === audio) { current = null; URL.revokeObjectURL(url); }
      reject(error);
    });
  });
}

/**
 * 朗读一条回复：长文本按段合成，播放当前段时已在合成下一段。
 * 返回 null 表示正常结束或被打断，否则是可以直接展示的错误文字。
 */
export async function speakReply(id: string, text: string): Promise<string | null> {
  const speech = api();
  if (!speech) return speechErrorText("failed");
  stopSpeaking();
  const mine = session;
  const chunks = splitSpeechText(text);
  if (!chunks.length) return speechErrorText("invalid");
  setPlayback({ id, status: "loading" });
  const voice = currentVoice();
  const synthesize = (index: number) => speech.synthesize({ text: chunks[index]!, voice });
  try {
    let pending = synthesize(0);
    for (let index = 0; index < chunks.length; index += 1) {
      const result = await pending;
      if (mine !== session) return null;
      if (!result.ok) { setPlayback(null); return speechErrorText(result.code); }
      if (index + 1 < chunks.length) pending = synthesize(index + 1);
      setPlayback({ id, status: "playing" });
      await playBytes(result.value, mine);
      if (mine !== session) return null;
    }
    setPlayback(null);
    return null;
  } catch (error) {
    log.warn("speech playback failed", error);
    if (mine === session) setPlayback(null);
    return mine === session ? speechErrorText("failed") : null;
  }
}
