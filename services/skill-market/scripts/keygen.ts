#!/usr/bin/env node
// 生成 Skill 市场专用的 Ed25519 签名密钥对（只需做一次）。
//
// 私钥写到 ~/.vela-market/market-signing.key（权限 600），不进仓库、不进 Cloudflare、不进 CI，
// 也不要打印或外传。公钥只打印到终端，填进 packages/shared/src/marketplace-config.ts 的
// marketplacePublicKeys，随 App 发布。私钥丢了就发不了新目录，请备份到密码管理器或加密介质；
// 私钥泄露要立即从公钥清单里汰除并发新版 App。
//
//   pnpm market:keygen          生成密钥（已存在则拒绝覆盖）
//   pnpm market:keygen --show   只打印现有私钥对应的公钥
import { generateKeyPairSync } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { loadMarketPrivateKey, marketKeyPath, rawPublicKey } from "./keys.ts";

const path = marketKeyPath();

if (process.argv.includes("--show")) {
  console.log(rawPublicKey(loadMarketPrivateKey()));
} else {
  if (existsSync(path)) {
    console.error(`私钥已存在：${path}\n为避免覆盖，已停止。要查看公钥请加 --show。`);
    process.exit(1);
  }
  const { privateKey } = generateKeyPairSync("ed25519");
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, privateKey.export({ format: "pem", type: "pkcs8" }), { mode: 0o600, flag: "wx" });
  chmodSync(path, 0o600);
  console.log(`私钥已写入 ${path}（请备份，不要提交或外传）`);
  console.log("公钥（填入 packages/shared/src/marketplace-config.ts 的 marketplacePublicKeys）：");
  console.log(rawPublicKey(privateKey));
}
