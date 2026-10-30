/** Focused icon-theme checks: node apps/desktop/test/file-icons-ui.mjs */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktop = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(join(desktop, "package.json"));
const paths = ["src/App.TSX", "src/app.jsx", "Dockerfile", ".dockerignore", "C:\\src\\main.PY", "README", "unknown.xyz"];

if (!process.versions.electron) {
  const temp = mkdtempSync(join(tmpdir(), "vela-file-icons-"));
  try {
    const { build } = await import("esbuild");
    await build({
      stdin: {
        contents: `
          import { createRoot } from 'react-dom/client';
          import { usePreferences } from './src/renderer/hooks/usePreferences';
          import { FileIconThemeProvider, FileTypeIcon } from './src/renderer/components/FileTypeIcon';
          import { AppearancePage } from './src/renderer/components/settings/AppearancePage';
          import { settingsCopy } from './src/renderer/components/settings-copy';
          function Preview() {
            const preferences = usePreferences();
            return <>
              <AppearancePage copy={settingsCopy(preferences.locale)} preferences={preferences} />
              <FileIconThemeProvider value={preferences.fileIconTheme}>
                <div id="samples">{${JSON.stringify(paths)}.map(path => <span key={path} data-path={path}><FileTypeIcon path={path} /></span>)}</div>
              </FileIconThemeProvider>
            </>;
          }
          createRoot(document.getElementById('root')).render(<Preview />);
        `,
        resolveDir: desktop,
        loader: "tsx",
      },
      alias: { "@vela/shared": resolve(desktop, "../../packages/shared/src/index.ts") },
      loader: { ".svg": "dataurl" },
      bundle: true,
      outfile: join(temp, "ui.js"),
      platform: "browser",
      format: "iife",
      jsx: "automatic",
      define: { "process.env.NODE_ENV": '"development"' },
    });
    writeFileSync(join(temp, "index.html"), `<!doctype html><html><head><meta charset="utf-8"><style>${readFileSync(join(desktop, "src/renderer/styles.css"), "utf8")}</style></head><body><div id="root"></div><script src="ui.js"></script></body></html>`);
    const env = { ...process.env, VELA_FILE_ICONS_TEMP: temp };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require("electron"), [fileURLToPath(import.meta.url)], { env, stdio: "inherit" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 45000);
    try {
      assert.equal(await new Promise((res, rej) => { child.once("error", rej); child.once("exit", res); }), 0);
    } finally { clearTimeout(timer); }
  } finally { rmSync(temp, { recursive: true, force: true }); }
} else {
  const { app, BrowserWindow } = await import("electron");
  app.setPath("userData", join(process.env.VELA_FILE_ICONS_TEMP, "profile"));
  void app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, width: 1100, height: 900, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
    const errors = [];
    win.webContents.on("console-message", event => { if (event.level === "error") errors.push(event.message); });
    const evaluate = code => win.webContents.executeJavaScript(code, true);
    const until = async (code, label) => {
      for (let i = 0; i < 100; i++) {
        if (await evaluate(code)) return;
        await new Promise(resolve => setTimeout(resolve, 30));
      }
      throw new Error(`Timed out: ${label}`);
    };
    const block = '[data-setting-id="file-icon-theme"]';
    const select = async label => {
      await evaluate(`[...document.querySelectorAll('${block} button')].find(button => button.textContent === ${JSON.stringify(label)}).click()`);
      await until(`localStorage.getItem('vela.fileIconTheme') === ${JSON.stringify(label === "Catppuccin" ? "catppuccin" : label === "Devicon" ? "devicon" : "material")}`, `save ${label}`);
      await until(`[...document.querySelectorAll('#samples img')].every(img => img.complete && img.naturalWidth > 0)`, "load icons");
    };
    try {
      await win.loadFile(join(process.env.VELA_FILE_ICONS_TEMP, "index.html"));
      await until(`!!document.querySelector('${block} button')`, "appearance settings");
      assert.deepEqual(await evaluate(`[...document.querySelectorAll('${block} button')].map(button => button.textContent)`), ["Material Icon Theme", "Devicon", "Catppuccin"]);
      const original = await evaluate("document.querySelector('#samples img').src");
      await select("Catppuccin");
      assert.equal(await evaluate(`document.querySelector('${block} button[aria-checked="true"]').textContent`), "Catppuccin");
      const sources = await evaluate("[...document.querySelectorAll('#samples img')].map(img => img.src)");
      assert.equal(sources.length, paths.length);
      assert.notEqual(sources[0], original);
      assert.notEqual(sources[0], sources[1], "TSX and JSX use distinct React icons");
      assert.equal(sources[2], sources[3], "Dockerfile and .dockerignore share the Docker icon");
      assert.equal(sources[5], sources[6], "unknown files use the Catppuccin fallback");
      assert.ok(sources.every(src => src.startsWith("data:image/svg+xml")), "icons are bundled for offline use");
      assert.ok(await evaluate("[...document.querySelectorAll('#samples img')].every(img => img.alt === '' && img.getAttribute('aria-hidden') === 'true')"));
      win.webContents.reload();
      await until(`document.querySelector('${block} button[aria-checked="true"]')?.textContent === 'Catppuccin'`, "restore saved theme");
      await until("[...document.querySelectorAll('#samples img')].every(img => img.complete && img.naturalWidth > 0)", "reload icons");
      assert.deepEqual(await evaluate("[...document.querySelectorAll('#samples img')].map(img => img.src)"), sources);
      await select("Devicon");
      assert.equal(await evaluate("document.querySelectorAll('#samples img').length"), 5);
      await select("Material Icon Theme");
      assert.equal(await evaluate("document.querySelector('#samples img').src"), original);
      assert.deepEqual(errors, []);
      console.log("PASS icon themes switch, load offline SVGs, preserve fallbacks and restore Catppuccin after reload");
      app.exit(0);
    } catch (error) {
      console.error(error);
      app.exit(1);
    }
  });
}
