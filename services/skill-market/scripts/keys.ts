import { createPrivateKey, createPublicKey, type KeyObject } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** 市场专用私钥，只在维护者本机；不与发版用的 update 密钥共用。 */
export const defaultMarketKeyPath = join(homedir(), ".vela-market", "market-signing.key");

export function marketKeyPath(): string {
  return process.env.VELA_MARKET_KEY?.trim() || defaultMarketKeyPath;
}

/** 32 字节原始公钥（base64），与应用内置格式一致。 */
export function rawPublicKey(privateKey: KeyObject): string {
  const spki = createPublicKey(privateKey).export({ format: "der", type: "spki" });
  return spki.subarray(spki.length - 32).toString("base64");
}

export function loadMarketPrivateKey(): KeyObject {
  const path = marketKeyPath();
  if (!existsSync(path)) throw new Error(`找不到市场签名私钥：${path}\n先运行 pnpm market:keygen 生成。`);
  return createPrivateKey(readFileSync(path));
}
