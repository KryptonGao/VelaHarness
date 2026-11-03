// 把 CLI 与 @vela/* 工作区源码打成单个 Node ESM 文件；Pi SDK 等运行依赖保持外部。
// 构建不依赖 Electron，生产入口也不依赖测试用的 register-ts.mjs。
import { chmodSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = dirname(fileURLToPath(import.meta.url));
const repo = resolve(root, "../..");
const workspacePackages = ["agent", "shared", "tools", "workspace", "runner"];

/** 工作区包声明的第三方依赖：运行时从 node_modules 解析，不打进包里。 */
const external = new Set();
for (const name of workspacePackages) {
  const manifest = JSON.parse(readFileSync(resolve(repo, "packages", name, "package.json"), "utf8"));
  for (const dependency of Object.keys(manifest.dependencies ?? {})) if (!dependency.startsWith("@vela/")) external.add(dependency);
}

const alias = Object.fromEntries(workspacePackages.map((name) => [`@vela/${name}`, resolve(repo, "packages", name, "src/index.ts")]));
const outfile = resolve(root, "out/cli.mjs");

await build({
  entryPoints: [resolve(root, "src/cli.ts")],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  alias,
  external: [...external, ...[...external].map((name) => `${name}/*`)],
  banner: { js: "#!/usr/bin/env node" },
  legalComments: "none",
  logLevel: "warning",
});
chmodSync(outfile, 0o755);
console.log(`built ${outfile}`);
