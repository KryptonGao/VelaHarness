/** 使用统计热力图悬停提示检查：node apps/desktop/test/usage-heatmap-ui.mjs（VELA_HEATMAP_SCREENSHOT=目录 可截图） */
import { readStyles } from "./read-styles.mjs";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(here, "../package.json"));

if (!process.versions.electron) {
  const temporary = mkdtempSync(join(tmpdir(), "vela-usage-heatmap-"));
  try {
    const { build } = await import("esbuild");
    await build({
      stdin: {
        contents: `
          import React from 'react';
          import { createRoot } from 'react-dom/client';
          import { ButtonTooltip } from './apps/desktop/src/renderer/components/ButtonTooltip';
          import { UsageReport } from './apps/desktop/src/renderer/components/usage/UsageView';
          import { AppLocaleProvider, setActiveLocale } from './apps/desktop/src/renderer/locale';

          const params = new URLSearchParams(location.search);
          const locale = params.get('locale') === 'en' ? 'en' : 'zh-CN';
          setActiveLocale(locale);
          const day = (dateStr, hour = 10) => new Date(dateStr + 'T' + String(hour).padStart(2, '0') + ':00:00').getTime();
          const requests = [
            {
              id: 'r-million-1', number: 1, turn: 1, model: 'openai/gpt-5', status: 'Completed', contextId: 'c1',
              startedAt: day('2026-11-20', 9), completedAt: day('2026-11-20', 9) + 1000,
              durationMs: 1000, firstTokenMs: 200, generationMs: 800,
              usage: { input: 2_000_000, output: 500_000, cacheRead: 10_000_000, cacheWrite: 340_000, totalTokens: 12_840_000 },
            },
            {
              id: 'r-million-2', number: 2, turn: 1, model: 'openai/gpt-5', status: 'Completed', contextId: 'c1',
              startedAt: day('2026-11-20', 11), completedAt: day('2026-11-20', 11) + 1000,
              durationMs: 1000, firstTokenMs: 200, generationMs: 800,
              usage: { input: 1_000_000, output: 200_000, cacheRead: 1_300_000, cacheWrite: 0, totalTokens: 2_500_000 },
            },
            {
              id: 'r-billion', number: 3, turn: 1, model: 'openai/gpt-5', status: 'Completed', contextId: 'c2',
              startedAt: day('2026-11-22', 14), completedAt: day('2026-11-22', 14) + 1000,
              durationMs: 1000, firstTokenMs: 200, generationMs: 800,
              usage: { input: 50_000_000, output: 10_000_000, cacheRead: 1_190_000_000, cacheWrite: 0, totalTokens: 1_250_000_000 },
            },
            {
              id: 'r-unmetered', number: 4, turn: 1, model: 'openai/gpt-5', status: 'Completed', contextId: 'c3',
              startedAt: day('2026-11-21', 15), completedAt: day('2026-11-21', 15) + 1000,
              durationMs: 1000, firstTokenMs: 200, generationMs: 800,
              usage: null,
            },
          ];
          createRoot(document.getElementById('root')).render(
            <AppLocaleProvider locale={locale}>
              <div className="settings-view" style={{ padding: 24, background: 'var(--bg-chat)', height: '100vh', overflow: 'auto', boxSizing: 'border-box' }}>
                <div className="settings-usage" style={{ position: 'relative', zIndex: 2, width: '100%' }}>
                  <UsageReport
                    requests={requests}
                    providers={[{ id: 'openai', name: 'OpenAI' }]}
                    settings
                    start="2026-11-01"
                    end="2026-11-25"
                  />
                </div>
              </div>
              <ButtonTooltip />
            </AppLocaleProvider>,
          );
        `,
        resolveDir: resolve(here, "../../.."),
        loader: "tsx",
      },
      bundle: true,
      platform: "browser",
      format: "iife",
      jsx: "automatic",
      outfile: join(temporary, "ui.js"),
      loader: { ".svg": "dataurl" },
      define: { "process.env.NODE_ENV": '"development"', "import.meta.env.DEV": "false" },
    });
    writeFileSync(
      join(temporary, "index.html"),
      '<!doctype html><html data-scheme="light"><head><meta charset="utf-8"><style>' +
        readStyles(join(here, "../src/renderer/styles.css")) +
        readFileSync(join(here, "../src/renderer/components/usage/usage.css"), "utf8") +
        '</style></head><body><div id="root"></div><script src="ui.js"></script></body></html>',
    );
    const env = { ...process.env, VELA_HEATMAP_TEMP: temporary };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require("electron"), [fileURLToPath(import.meta.url)], { env, stdio: "inherit" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 45000);
    try {
      const code = await new Promise((done, reject) => {
        child.once("error", reject);
        child.once("exit", done);
      });
      assert.equal(code, 0, "Usage heatmap hover tooltip checks failed");
    } finally {
      clearTimeout(timer);
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
} else {
  const { app, BrowserWindow } = await import("electron");
  app.setPath("userData", join(process.env.VELA_HEATMAP_TEMP, "profile"));
  app.on("window-all-closed", () => {});
  void app.whenReady().then(async () => {
    let failed = false;
    try {
      const shots = process.env.VELA_HEATMAP_SCREENSHOT;
      if (shots) mkdirSync(shots, { recursive: true });
      for (const locale of ["zh-CN", "en"]) {
        const win = new BrowserWindow({
          show: false,
          width: 1040,
          height: 760,
          useContentSize: true,
          webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
        });
        await win.loadFile(join(process.env.VELA_HEATMAP_TEMP, "index.html"), { query: { locale } });
        const evaluate = code => win.webContents.executeJavaScript(code);
        const until = async code => {
          const deadline = Date.now() + 5000;
          while (Date.now() < deadline) {
            if (await evaluate(code)) return;
            await new Promise(done => setTimeout(done, 20));
          }
          throw new Error(`Timed out: ${code}`);
        };
        await until("document.querySelector('.usage-heatmap-cell[data-day=\"2026-11-20\"]')");
        // Scroll the activity section into view so mouseMove coordinates land inside the viewport.
        await evaluate("document.querySelector('.usage-activity').scrollIntoView({ block: 'center' })");

        const hoverDay = async (day) => {
          const point = await evaluate(`(() => {
            const cell = document.querySelector('.usage-heatmap-cell[data-day="${day}"]');
            const rect = cell.getBoundingClientRect();
            return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2), top: rect.top };
          })()`);
          win.webContents.sendInputEvent({ type: "mouseMove", x: point.x, y: point.y });
          await until(`document.querySelector('.usage-heatmap-tooltip:popover-open')?.textContent?.includes('${day}')`);
          return {
            point,
            tooltip: await evaluate(`(() => {
              const el = document.querySelector('.usage-heatmap-tooltip');
              const rect = el.getBoundingClientRect();
              return {
                date: el.querySelector('.usage-heatmap-tooltip-date')?.textContent ?? '',
                metric: el.querySelector('.usage-heatmap-tooltip-metric')?.textContent ?? '',
                left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
                buttonTooltip: Boolean(document.querySelector('.button-tooltip')),
              };
            })()`),
          };
        };

        // 1. Million-scale tokens (12.84M + 2.50M = 15.34M -> 15.3M)
        const million = await hoverDay("2026-11-20");
        assert.equal(million.tooltip.date, "2026-11-20");
        assert.equal(
          million.tooltip.metric,
          locale === "en" ? "2 requests · 15.3M tokens" : "2 次请求 · 15.3M Token",
        );
        assert.equal(million.tooltip.buttonTooltip, false);
        assert.ok(million.tooltip.bottom <= million.point.top, "Tooltip sits above the hovered cell");
        assert.ok(million.tooltip.left >= 8 && million.tooltip.right <= 1040 - 8, "Tooltip stays inside viewport");

        if (shots && locale === "zh-CN") {
          await new Promise(done => setTimeout(done, 150));
          writeFileSync(join(shots, "heatmap-hover-million.png"), (await win.webContents.capturePage()).toPNG());
        }

        // 2. Billion-scale tokens (1.25B -> 1.3B)
        const billion = await hoverDay("2026-11-22");
        assert.equal(billion.tooltip.date, "2026-11-22");
        assert.equal(
          billion.tooltip.metric,
          locale === "en" ? "1 request · 1.3B tokens" : "1 次请求 · 1.3B Token",
        );

        // 3. Unmetered day (requests > 0, metered === 0 -> never shows 0.0M)
        const unmetered = await hoverDay("2026-11-21");
        assert.equal(unmetered.tooltip.date, "2026-11-21");
        assert.equal(
          unmetered.tooltip.metric,
          locale === "en" ? "1 request · Unmetered tokens" : "1 次请求 · Token 未计量",
        );

        // 4. Zero-request day inside range -> 0.0M
        const empty = await hoverDay("2026-11-19");
        assert.equal(empty.tooltip.date, "2026-11-19");
        assert.equal(
          empty.tooltip.metric,
          locale === "en" ? "0 requests · 0.0M tokens" : "0 次请求 · 0.0M Token",
        );

        // 5. Excluded day outside selected range
        const excluded = await hoverDay("2026-10-15");
        assert.equal(excluded.tooltip.date, "2026-10-15");
        assert.equal(
          excluded.tooltip.metric,
          locale === "en" ? "Outside selected range" : "不在所选范围",
        );

        // 6. Leaving the heatmap dismisses the tooltip
        win.webContents.sendInputEvent({ type: "mouseMove", x: 5, y: 5 });
        await until("!document.querySelector('.usage-heatmap-tooltip')");

        win.destroy();
      }
      console.log("Usage heatmap hover tooltip UI checks passed (zh-CN + en)");
    } catch (error) {
      failed = true;
      console.error(error);
    } finally {
      app.exit(failed ? 1 : 0);
    }
  });
}
