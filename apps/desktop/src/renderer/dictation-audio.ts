import { dictationLimits } from "@vela/shared";

/** 把若干段单声道浮点采样（输入采样率 inputRate）线性重采样到 16 kHz，并量化为 16 位。 */
export function toPcm16(chunks: readonly Float32Array[], inputRate: number, outputRate: number = dictationLimits.sampleRate): Int16Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const samples = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) { samples.set(chunk, offset); offset += chunk.length; }

  const ratio = inputRate / outputRate;
  const length = Math.floor(total / ratio);
  const out = new Int16Array(length);
  for (let index = 0; index < length; index += 1) {
    const position = index * ratio;
    const base = Math.floor(position);
    const next = Math.min(base + 1, total - 1);
    const fraction = position - base;
    const value = samples[base]! * (1 - fraction) + samples[next]! * fraction;
    const clamped = Math.max(-1, Math.min(1, value));
    out[index] = clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
  }
  return out;
}

/** 单声道 16 位 PCM WAV（DeepSeek ASR 接受的格式之一）。 */
export function encodeWav(samples: Int16Array, sampleRate: number = dictationLimits.sampleRate): Uint8Array {
  const bytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + bytes);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, "RIFF");
  view.setUint32(4, 36 + bytes, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // 单声道
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, bytes, true);
  for (let index = 0; index < samples.length; index += 1) view.setInt16(44 + index * 2, samples[index]!, true);
  return new Uint8Array(buffer);
}

/** 在已有文字后追加识别结果：两侧都是字母数字时补一个空格，其余（中日韩、标点、换行）直接相接。 */
export function dictationSeparator(before: string, text: string): string {
  if (!before || !text) return "";
  return /[A-Za-z0-9]$/.test(before) && /^[A-Za-z0-9]/.test(text) ? " " : "";
}
