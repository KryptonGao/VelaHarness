/**
 * 朗读（DeepSeek TTS）：密钥只写入主进程的加密存储，界面只能看到「是否已配置」。
 * 接口文档：https://api-docs.deepseek.com/zh-cn/guides/tts
 */

export interface SpeechState {
  /** 已保存 API 密钥。未配置时界面不显示朗读按钮。 */
  configured: boolean;
  /** 系统是否能安全保存密钥。 */
  keysAvailable: boolean;
}

export type SpeechFailureCode = "no-key" | "invalid" | "auth" | "rejected" | "busy" | "timeout" | "network" | "failed";

export type SpeechResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: SpeechFailureCode; message: string };

export interface SpeechApi {
  getState(): Promise<SpeechResult<SpeechState>>;
  /** apiKey 为 null 表示清除。 */
  setApiKey(input: { apiKey: string | null }): Promise<SpeechResult<SpeechState>>;
  /** 合成一段文字，返回 WAV 音频字节。单次文字不超过 speechLimits.chunkBilling。 */
  synthesize(input: { text: string }): Promise<SpeechResult<Uint8Array>>;
}

export const speechLimits = {
  keyMax: 4000,
  /** 接口单次上限是 10000 计费字符；留出余量，长回复按段合成。 */
  chunkBilling: 3000,
  /** 请求体上限 64 KiB。 */
  bodyBytesMax: 64 * 1024,
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
