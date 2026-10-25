/** 用真实 renderer 组件渲染 README 示例并截 2× PNG：node apps/desktop/test/readme-capture.mjs <compact|subagents|trace> [端口] */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scene = process.argv[2] ?? "compact";
const port = process.argv[3] ?? "5179";
const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(here, "../package.json"));
if (!process.versions.electron) {
  const env = { ...process.env, VELA_README_SCENE: scene, VELA_README_PORT: port };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require("electron"), [fileURLToPath(import.meta.url)], { env, stdio: "inherit" });
  const timer = setTimeout(() => child.kill("SIGKILL"), 60000);
  try {
    const code = await new Promise((done, reject) => { child.once("error", reject); child.once("exit", done); });
    assert.equal(code, 0, `README capture failed for scene ${scene}`);
  } finally { clearTimeout(timer); }
} else {
  const { app, BrowserWindow } = await import("electron");
  const output = resolve(here, "../../../assets/readme/source/shots", `vela-${scene}.png`);
  void app.whenReady().then(async () => {
    // 隐藏窗口按 2× 尺寸创建，加载后把缩放设为 2：CSS 布局仍是 1440×960，capturePage 输出 2880×1920。
    const win = new BrowserWindow({ show: false, width: 1440, height: 960,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    const errors = [];
    win.webContents.on("console-message", event => { if (event.level >= 3) errors.push(event.message); });
    const evaluate = code => win.webContents.executeJavaScript(code);
    const until = async code => {
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) { if (await evaluate(code)) return; await new Promise(done => setTimeout(done, 20)); }
      throw new Error(`Timed out: ${code}\n${errors.join("\n")}`);
    };
    // 按可见文本点击：selector 限定元素种类，regex 匹配 textContent。
    const clickText = async (selector, source, flags = "") => {
      const result = await evaluate(`(() => {
        const pattern = new RegExp(${JSON.stringify(source)}, ${JSON.stringify(flags)});
        const elements = [...document.querySelectorAll(${JSON.stringify(selector)})];
        const target = elements.find(element => pattern.test(element.textContent));
        if (!target) return { clicked: false, seen: elements.slice(0, 60).map(element => element.textContent.trim().slice(0, 40)) };
        target.click();
        return { clicked: true };
      })()`);
      assert.deepEqual(result, { clicked: true }, `no ${selector} matches /${source}/${flags}`);
      await new Promise(done => setTimeout(done, 700));
    };
    try {
      await win.loadURL(`http://127.0.0.1:${process.env.VELA_README_PORT}/test/readme-preview.html?scene=${process.env.VELA_README_SCENE}`);
      await until("Boolean(document.querySelector('.vela-window'))");
      await new Promise(done => setTimeout(done, 1500));

      if (scene === "compact") {
        await clickText("button", "^用时");
        await clickText("button", "已搜索 1 次");
        await clickText("button", "^已编辑 3 个文件");
      } else if (scene === "subagents") {
        await clickText("button", "^用时");
        await clickText("button", "pnpm test");
      } else if (scene === "trace") {
        await clickText("[role=tab]", "^轨迹$");
        await new Promise(done => setTimeout(done, 800));
        await clickText("[role=option]", 'bash \\{"command":"pnpm test');
      } else {
        throw new Error(`unknown scene ${scene}`);
      }

      await new Promise(done => setTimeout(done, 1200));
      // 让 CSS 视口保持 1440×960、输出像素保持 2880×1920：缩放补足屏幕缩放与 2 的差距。
      const dpr = await evaluate(() => window.devicePixelRatio);
      const zoom = 2 / dpr;
      if (zoom !== 1) {
        win.setContentSize(Math.round(1440 * zoom), Math.round(960 * zoom));
        await new Promise(done => setTimeout(done, 400));
        await win.webContents.setZoomFactor(zoom);
      }
      await new Promise(done => setTimeout(done, 600));
      const image = await win.webContents.capturePage();
      assert.deepEqual([image.getSize().width, image.getSize().height], [2880, 1920], "capture is not 2880×1920");
      const { writeFileSync } = await import("node:fs");
      writeFileSync(output, image.toPNG());
      assert.equal(errors.length, 0, `console errors:\n${errors.join("\n")}`);
      console.log(`captured ${output}`);
      await app.quit();
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
      await app.quit();
    }
  });
}
