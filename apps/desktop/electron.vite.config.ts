import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

const root = dirname(fileURLToPath(import.meta.url));
const shared = resolve(root, "../../packages/shared/src/index.ts");
const agent = resolve(root, "../../packages/agent/src/index.ts");
const tools = resolve(root, "../../packages/tools/src/index.ts");
const workspace = resolve(root, "../../packages/workspace/src/index.ts");
const runner = resolve(root, "../../packages/runner/src/index.ts");

const sharedSignature = resolve(root, "../../packages/shared/src/signature.ts");

// 更具体的子路径必须排在 @vela/shared 之前，否则会被前缀替换成入口文件下的路径。
const workspaceAlias = {
  "@vela/shared/signature": sharedSignature,
  "@vela/shared": shared,
  "@vela/agent": agent,
  "@vela/tools": tools,
  "@vela/workspace": workspace,
  "@vela/runner": runner,
};

export default defineConfig({
  main: {
    plugins: [{
      name: "vela-mac-hold-to-quit",
      buildStart() { if (process.platform === "darwin") this.addWatchFile(resolve(root, "native/hold-to-quit.m")); },
      generateBundle() {
        if (process.platform !== "darwin") return;
        // Only the stable C Node-API is needed; Node distributions include these headers.
        const includes = resolve(dirname(realpathSync(process.execPath)), "../include/node");
        const temp = mkdtempSync(resolve(tmpdir(), "vela-native-build-"));
        const binary = resolve(temp, "hold-to-quit.node");
        try {
          execFileSync("xcrun", ["clang", "-fobjc-arc", "-fblocks", "-O2", "-mmacosx-version-min=12.0", "-bundle", "-undefined", "dynamic_lookup",
            "-I", includes, "-framework", "AppKit", "-framework", "QuartzCore", resolve(root, "native/hold-to-quit.m"), "-o", binary], { stdio: "inherit" });
          this.emitFile({ type: "asset", fileName: "hold-to-quit.node", source: readFileSync(binary) });
        } finally { rmSync(temp, { recursive: true, force: true }); }
      },
    }, {
      name: "vela-builtin-browser-skill",
      generateBundle() {
        this.emitFile({ type: "asset", fileName: "skills/browser-use/SKILL.md",
          source: readFileSync(resolve(root, "../../packages/agent/skills/browser-use/SKILL.md"), "utf8") });
        // Vela 内置 Skill：回答「如何改界面颜色」等关于应用本身的问题，由主进程作为内置目录加载。
        this.emitFile({ type: "asset", fileName: "skills/vela/SKILL.md",
          source: readFileSync(resolve(root, "../../packages/agent/skills/vela/SKILL.md"), "utf8") });
        // 引导里的「新到港」读取这份随包发布的多语言发布说明，与 GitHub Release 正文无关。
        this.emitFile({ type: "asset", fileName: "release-notes.json",
          source: readFileSync(resolve(root, "release-notes.json"), "utf8") });
        // 窗口图标与菜单栏图标随 out 一起进 asar；?asset 在正式版会指向包外的 resources/，导致图标缺失。
        for (const name of ["icon.png", "tray-template.png"]) {
          this.emitFile({ type: "asset", fileName: name, source: readFileSync(resolve(root, "resources", name)) });
        }
      },
    }],
    resolve: { alias: workspaceAlias },
    build: {
      rollupOptions: {
        input: {
          index: resolve(root, "src/main/index.ts"),
          "browser-repl-worker": resolve(root, "src/main/browser-repl-worker.ts"),
          "codex-usage-worker": resolve(root, "src/main/codex-usage-worker.ts"),
          "search-worker": resolve(root, "src/main/search-worker.ts"),
        },
        output: { format: "es", entryFileNames: "[name].mjs" },
      },
      externalizeDeps: {
        exclude: ["@vela/shared", "@vela/agent", "@vela/tools", "@vela/workspace", "@vela/runner"],
        include: ["@earendil-works/pi-coding-agent", "@earendil-works/pi-ai"],
      },
    },
  },
  preload: {
    resolve: { alias: { "@vela/shared": shared } },
    build: {
      externalizeDeps: {
        exclude: ["@vela/shared"],
      },
    },
  },
  renderer: {
    // Standalone Vite previews and tests rebuild the default dependency cache.
    cacheDir: resolve(root, "node_modules/.vite-renderer"),
    resolve: { alias: { "@vela/shared": shared } },
    plugins: [react()],
  },
});
