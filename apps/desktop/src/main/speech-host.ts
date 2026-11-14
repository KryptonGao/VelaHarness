/**
 * 回复朗读：调用 DeepSeek TTS（POST /v1/tools/tts）把文字合成为 WAV。
 * 密钥写入加密存储后只能得到「已配置」，不会再回到界面。
 */
import { BrowserWindow, ipcMain } from "electron";
import type { CredentialStore } from "@vela/agent";
import {
  IpcChannel, createLogger, defaultSpeechVoice, isSpeechVoice, speechLimits,
  type SpeechFailureCode, type SpeechResult, type SpeechState, type SpeechVoice,
} from "@vela/shared";

const log = createLogger("speech");
const endpoint = "https://api.deepseek.com/v1/tools/tts";
const requestTimeoutMs = 120_000;

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

class SpeechError extends Error {
  constructor(readonly code: SpeechFailureCode, message: string) { super(message); }
}

export function parseSetKeyRequest(raw: unknown): { apiKey: string | null } {
  if (!record(raw) || Object.keys(raw).some(key => key !== "apiKey")) throw new SpeechError("invalid", "请求格式不正确");
  const { apiKey } = raw;
  if (apiKey === null) return { apiKey: null };
  if (typeof apiKey !== "string") throw new SpeechError("invalid", "密钥必须是文本或 null");
  const trimmed = apiKey.trim();
  if (!trimmed || trimmed.length > speechLimits.keyMax || /\s/.test(trimmed)) throw new SpeechError("invalid", "密钥格式不正确");
  return { apiKey: trimmed };
}

export function parseSynthesizeRequest(raw: unknown): { text: string; voice: SpeechVoice } {
  if (!record(raw) || Object.keys(raw).some(key => key !== "text" && key !== "voice")) throw new SpeechError("invalid", "请求格式不正确");
  if (raw.voice !== undefined && !isSpeechVoice(raw.voice)) throw new SpeechError("invalid", "不支持这个音色");
  if (typeof raw.text !== "string" || !raw.text.trim()) throw new SpeechError("invalid", "没有可朗读的文字");
  if (Buffer.byteLength(raw.text, "utf8") > speechLimits.bodyBytesMax - 1024) throw new SpeechError("invalid", "朗读的文字过长");
  return { text: raw.text, voice: raw.voice ?? defaultSpeechVoice };
}

interface SpeechServiceOptions {
  fetch?: typeof fetch;
}

export class SpeechService {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly store: CredentialStore, options: SpeechServiceOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  getState(): SpeechState {
    try {
      return { configured: Boolean(this.readKey()), keysAvailable: true };
    } catch {
      return { configured: false, keysAvailable: false };
    }
  }

  setApiKey(apiKey: string | null): SpeechState {
    try {
      this.store.withLock(() => ({ result: undefined, next: JSON.stringify({ apiKey }) }));
    } catch (error) {
      log.warn("saving speech key failed", error);
      throw new SpeechError("failed", "无法保存密钥：系统的安全存储不可用");
    }
    return this.getState();
  }

  async synthesize(text: string, signal?: AbortSignal, voice: SpeechVoice = defaultSpeechVoice): Promise<Uint8Array> {
    let key: string | undefined;
    try { key = this.readKey(); } catch { throw new SpeechError("failed", "无法读取已保存的密钥"); }
    if (!key) throw new SpeechError("no-key", "还没有配置朗读的 API 密钥");

    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), requestTimeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
    try {
      const response = await this.fetchImpl(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice_id: voice, format: "wav", filter_markdown: true }),
        signal: combined,
      });
      if (!response.ok) throw this.httpError(response.status);
      const audio = new Uint8Array(await response.arrayBuffer());
      // 合成中途失败时连接会被截断；没有任何音频就当作失败。
      if (audio.byteLength === 0) throw new SpeechError("failed", "朗读服务没有返回音频");
      return audio;
    } catch (error) {
      if (error instanceof SpeechError) throw error;
      if (timeout.signal.aborted) throw new SpeechError("timeout", "朗读超时");
      if (signal?.aborted) throw new SpeechError("failed", "朗读已取消");
      log.warn("speech request failed", error);
      throw new SpeechError("network", "无法连接朗读服务");
    } finally {
      clearTimeout(timer);
    }
  }

  private httpError(status: number): SpeechError {
    if (status === 401 || status === 403) return new SpeechError("auth", "API 密钥无效或没有权限");
    if (status === 400) return new SpeechError("rejected", "这段文字无法朗读");
    if (status === 429 || status === 503) return new SpeechError("busy", "朗读服务繁忙，请稍后再试");
    if (status === 504) return new SpeechError("timeout", "朗读超时");
    return new SpeechError("failed", `朗读服务返回错误（${status}）`);
  }

  private readKey(): string | undefined {
    return this.store.withLock<string | undefined>(current => {
      if (!current) return { result: undefined };
      try {
        const parsed = JSON.parse(current) as { apiKey?: unknown };
        return { result: typeof parsed.apiKey === "string" && parsed.apiKey ? parsed.apiKey : undefined };
      } catch {
        return { result: undefined };
      }
    });
  }
}

function failure(error: unknown): SpeechResult<never> {
  if (error instanceof SpeechError) return { ok: false, code: error.code, message: error.message };
  log.warn("speech request failed", error);
  return { ok: false, code: "failed", message: "朗读失败" };
}

export class SpeechHost {
  private readonly channels: string[] = [];
  private readonly pending = new Set<AbortController>();
  private readonly service: SpeechService;

  constructor(store: CredentialStore, options: SpeechServiceOptions = {}) {
    this.service = new SpeechService(store, options);
  }

  register(): void {
    if (this.channels.length) return;
    const handle = (channel: string, action: (raw: unknown) => Promise<unknown> | unknown) => {
      this.channels.push(channel);
      ipcMain.handle(channel, async (event, raw: unknown) => {
        if (!BrowserWindow.fromWebContents(event.sender) || event.senderFrame !== event.sender.mainFrame) {
          throw new Error("朗读请求不可用");
        }
        try {
          return { ok: true, value: await action(raw) };
        } catch (error) {
          return failure(error);
        }
      });
    };
    handle(IpcChannel.speechGet, () => this.service.getState());
    handle(IpcChannel.speechSetKey, raw => this.service.setApiKey(parseSetKeyRequest(raw).apiKey));
    handle(IpcChannel.speechSynthesize, async raw => {
      const input = parseSynthesizeRequest(raw);
      const controller = new AbortController();
      this.pending.add(controller);
      try {
        return await this.service.synthesize(input.text, controller.signal, input.voice);
      } finally {
        this.pending.delete(controller);
      }
    });
  }

  dispose(): void {
    for (const controller of this.pending) controller.abort();
    this.pending.clear();
    for (const channel of this.channels.splice(0)) ipcMain.removeHandler(channel);
  }
}
