import { createPublicKey, verify, type KeyObject } from "node:crypto";

/**
 * Ed25519 签名校验：应用内更新与 Skill 市场共用。
 * 单独成文件并通过 `@vela/shared/signature` 引用，因为它依赖 node:crypto，
 * 不能放进会被打进渲染进程的 `@vela/shared` 入口。
 */

/** Ed25519 公钥的 SPKI DER 前缀；后面直接接 32 字节原始公钥。 */
const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");

export function publicKeyFromBase64(raw: string): KeyObject {
  const bytes = Buffer.from(raw.trim(), "base64");
  if (bytes.length !== 32) throw new Error("Ed25519 public key must be 32 bytes");
  return createPublicKey({ key: Buffer.concat([spkiPrefix, bytes]), format: "der", type: "spki" });
}

/** 签名文件是 64 字节签名的 base64 文本（允许首尾空白）。 */
export function decodeSignature(text: string): Buffer | null {
  const compact = text.trim();
  if (!/^[A-Za-z0-9+/]{86}==$/.test(compact)) return null;
  const bytes = Buffer.from(compact, "base64");
  return bytes.length === 64 ? bytes : null;
}

/** 任一内置公钥验证通过即可，便于将来轮换密钥。 */
export function verifySignature(data: Uint8Array, signatureText: string, publicKeys: readonly string[]): boolean {
  const signature = decodeSignature(signatureText);
  if (!signature) return false;
  for (const raw of publicKeys) {
    try {
      if (verify(null, data, publicKeyFromBase64(raw), signature)) return true;
    } catch {
      // 忽略损坏的公钥条目，继续尝试其他公钥。
    }
  }
  return false;
}
