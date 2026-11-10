/**
 * 更新包的信任链：发版时用离线私钥对 SHA256SUMS.txt 做 Ed25519 签名，
 * 应用只信任内置公钥验证通过的校验和，再用它核对下载的 zip。
 * 本文件只放纯函数，方便单测。
 */

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: readonly string[];
}

const versionPattern = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseVersion(input: string): ParsedVersion | null {
  const match = versionPattern.exec(input.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

/** 去掉 v 前缀后的规范版本号；格式不对返回 null。 */
export function normalizeVersion(input: string): string | null {
  const parsed = parseVersion(input);
  if (!parsed) return null;
  const core = `${parsed.major}.${parsed.minor}.${parsed.patch}`;
  return parsed.prerelease.length ? `${core}-${parsed.prerelease.join(".")}` : core;
}

/** semver 比较：a 比 b 新返回正数。预发布版本低于同号正式版。无法解析时返回 NaN。 */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return Number.NaN;
  for (const key of ["major", "minor", "patch"] as const) {
    if (left[key] !== right[key]) return left[key] - right[key];
  }
  if (!left.prerelease.length || !right.prerelease.length) return right.prerelease.length - left.prerelease.length;
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index++) {
    const x = left.prerelease[index];
    const y = right.prerelease[index];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const xNumeric = /^\d+$/.test(x);
    const yNumeric = /^\d+$/.test(y);
    if (xNumeric && yNumeric) return Number(x) - Number(y);
    if (xNumeric) return -1;
    if (yNumeric) return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

/** `shasum -a 256` 的输出：`<64 位十六进制>  <文件名>`，二进制模式下文件名前带 `*`。 */
export function parseChecksums(text: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([0-9a-fA-F]{64}) [ *]?(\S.*)$/.exec(line.trim());
    if (!match) continue;
    const name = match[2].trim();
    // 同名重复条目有歧义，整体当作无效。
    if (result.has(name)) return new Map();
    result.set(name, match[1].toLowerCase());
  }
  return result;
}

// 验签函数已移到 @vela/shared，Skill 市场也要用；这里转出，保持原有导入路径可用。
export { decodeSignature, publicKeyFromBase64, verifySignature } from "@vela/shared/signature";
