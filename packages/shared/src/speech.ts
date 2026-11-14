/**
 * 朗读（DeepSeek TTS）与语音输入（DeepSeek ASR）共用同一个密钥：密钥只写入主进程的加密存储，
 * 界面只能看到「是否已配置」。
 * 接口文档：https://api-docs.deepseek.com/zh-cn/guides/tts 、https://api-docs.deepseek.com/zh-cn/guides/asr
 */

export interface SpeechState {
  /** 已保存 API 密钥。未配置时界面不显示朗读和语音输入按钮。 */
  configured: boolean;
  /** 系统是否能安全保存密钥。 */
  keysAvailable: boolean;
}

export type SpeechFailureCode = "no-key" | "invalid" | "auth" | "rejected" | "busy" | "timeout" | "network" | "no-speech" | "failed";

export type SpeechResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: SpeechFailureCode; message: string };

export const speechVoices = ["stella", "tide"] as const;
export type SpeechVoice = (typeof speechVoices)[number];
export const defaultSpeechVoice: SpeechVoice = "stella";
export const isSpeechVoice = (value: unknown): value is SpeechVoice =>
  typeof value === "string" && (speechVoices as readonly string[]).includes(value);

export interface SpeechApi {
  getState(): Promise<SpeechResult<SpeechState>>;
  /** apiKey 为 null 表示清除。 */
  setApiKey(input: { apiKey: string | null }): Promise<SpeechResult<SpeechState>>;
  /** 合成一段文字，返回 WAV 音频字节。单次文字不超过 speechLimits.chunkBilling。 */
  synthesize(input: { text: string; voice?: SpeechVoice }): Promise<SpeechResult<Uint8Array>>;
  /** 识别一段录音（16 位 PCM WAV 或 Ogg Opus），再用 DeepSeek-Flash 整理成可直接发送的文字。 */
  transcribe(input: { audio: Uint8Array }): Promise<SpeechResult<SpeechTranscript>>;
}

export interface SpeechTranscript {
  /** 整理后的文字；整理失败时与识别原文相同。 */
  text: string;
  /** 是否经过了整理。 */
  refined: boolean;
}

export const speechLimits = {
  keyMax: 4000,
  /** 接口单次上限是 10000 计费字符；留出余量，长回复按段合成。 */
  chunkBilling: 3000,
  /** 请求体上限 64 KiB。 */
  bodyBytesMax: 64 * 1024,
} as const;

/** 语音识别接口的限制：单次不超过 120 秒、8 MiB。 */
export const dictationLimits = {
  audioBytesMax: 8 * 1024 * 1024,
  /** 录音时长上限（毫秒）；到时自动结束并识别。 */
  durationMsMax: 120_000,
  /** 录音统一重采样到 16 kHz 单声道 16 位，约 32 KB/秒，120 秒约 3.8 MB。 */
  sampleRate: 16_000,
} as const;

/** DeepSeek 的计费口径：汉字（及日韩等宽字符）算 2，其余算 1。 */
export function billingLength(text: string): number {
  let total = 0;
  for (const char of text) total += /[ᄀ-ᇿ⺀-鿿가-힯豈-﫿＀-￯]/u.test(char) ? 2 : 1;
  return total;
}

/**
 * 把长回复切成不超过 budget 的若干段：优先在空行、其次在换行和句末标点处断开，
 * 实在没有断点才硬切。空白段会被丢弃。
 */
export function splitSpeechText(text: string, budget: number = speechLimits.chunkBilling): string[] {
  const chunks: string[] = [];
  let current = "";
  let currentSize = 0;
  const flush = () => {
    const trimmed = current.trim();
    if (trimmed) chunks.push(trimmed);
    current = "";
    currentSize = 0;
  };
  const push = (piece: string) => {
    const size = billingLength(piece);
    if (currentSize + size > budget && current) flush();
    current += piece;
    currentSize += size;
  };

  for (const block of text.split(/(\n\s*\n)/)) {
    if (billingLength(block) <= budget) { push(block); continue; }
    // 超长段落：按行、再按句子拆。
    for (const line of block.split(/(?<=\n)/)) {
      if (billingLength(line) <= budget) { push(line); continue; }
      for (const sentence of line.split(/(?<=[。！？!?；;.])\s*/u)) {
        if (billingLength(sentence) <= budget) { push(sentence); continue; }
        let rest = "";
        let restSize = 0;
        for (const char of sentence) {
          const size = billingLength(char);
          if (restSize + size > budget) { push(rest); flush(); rest = ""; restSize = 0; }
          rest += char;
          restSize += size;
        }
        if (rest) push(rest);
      }
    }
  }
  flush();
  return chunks;
}
