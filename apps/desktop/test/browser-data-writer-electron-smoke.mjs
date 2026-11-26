/** Run with node apps/desktop/test/browser-data-writer-electron-smoke.mjs. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

if (!process.versions.electron) {
  const require = createRequire(import.meta.url);
  const temporary = mkdtempSync(join(tmpdir(), "vela-browser-import-"));
  try {
    const entry = join(temporary, "smoke.mjs");
    await require("esbuild").build({ entryPoints: [fileURLToPath(import.meta.url)], outfile: entry,
      platform: "node", format: "esm", bundle: true, external: ["electron", "esbuild"] });
    const env = { ...process.env, VELA_IMPORT_FIXTURE: temporary };
    delete env.ELECTRON_RUN_AS_NODE;
    for (const phase of ["import", "restart"]) {
      const child = spawnSync(require("electron"), [entry], {
        env: { ...env, VELA_IMPORT_PHASE: phase }, stdio: "inherit", timeout: 45_000,
      });
      if (child.error) throw child.error;
      process.exitCode = child.status ?? 1;
      if (process.exitCode) break;
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
} else {
  const { app, session, WebContentsView } = await import("electron");
  const { writeBrowserData } = await import("../src/main/browser-data-writer.ts");
  app.setPath("userData", process.env.VELA_IMPORT_FIXTURE);
  const requests = [];
  const serve = (request, response) => {
    if (request.url === "/worker.js") {
      response.setHeader("Content-Type", "text/javascript");
      response.end(`self.addEventListener('install', () => self.skipWaiting());
        self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
        self.addEventListener('fetch', event => event.respondWith(fetch(event.request)));`);
    } else {
      response.setHeader("Content-Type", "text/html");
      response.end('<!doctype html><link rel="icon" href="data:,"><title>Import fixture</title>');
    }
  };
  const servers = [createServer(serve), createServer(serve)];
  const views = [];
  const newView = ses => {
    const view = new WebContentsView({ webPreferences: { session: ses, sandbox: true } });
    views.push(view);
    return view.webContents;
  };
  async function run() {
    const watchdog = setTimeout(() => app.exit(1), 35_000);
    let status = 0;
    try {
      await app.whenReady();
      const target = session.fromPartition("persist:vela-ui-browser");
      const originFile = join(process.env.VELA_IMPORT_FIXTURE, "fixture-origin.txt");
      if (process.env.VELA_IMPORT_PHASE === "restart") {
        const page = newView(target);
        const origin = readFileSync(originFile, "utf8");
        await page.loadURL("data:text/html,<title>Fixture</title>", { baseURLForDataURL: origin + "/" });
        assert.equal(await page.executeJavaScript("localStorage.getItem('site')"), "second");
        assert.equal((await target.cookies.get({ url: "https://cookies.example.test" }))[0]?.value, "saved");
        console.log("PASS imported site data survives an Electron restart");
        return;
      }
      await Promise.all(servers.map(server => new Promise(resolve => server.listen(0, "127.0.0.1", resolve))));
      const [first, second] = servers.map(server => `http://127.0.0.1:${server.address().port}`);
      writeFileSync(originFile, second);
      target.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*"] }, (details, callback) => {
        requests.push(details.url);
        callback({});
      });
      const page = newView(target);
      await page.loadURL(first);
      await page.executeJavaScript(`(async () => {
        localStorage.setItem('keep', 'existing');
        await navigator.serviceWorker.register('/worker.js');
        await navigator.serviceWorker.ready;
        if (!navigator.serviceWorker.controller) await new Promise(resolve =>
          navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
      })()`);
      requests.length = 0;
      const literal = "quotes '\" + <>\n中文";
      const cookie = { url: "https://cookies.example.test", path: "/", name: "fixture", value: "saved",
        secure: true, httpOnly: true, sameSite: "strict", expirationDate: Math.floor(Date.now() / 1000) + 600 };
      const result = await writeBrowserData(target, { cookies: [cookie, { ...cookie, expirationDate: 1 },
        { ...cookie, domain: "unrelated.example.test" }],
        origins: [
          { origin: first, localStorage: [{ name: "site", value: literal }] },
          { origin: second, localStorage: [{ name: "site", value: "second" }] },
          { origin: "file:///tmp", localStorage: [{ name: "bad", value: "bad" }] },
        ], skipped: 1 });
      assert.deepEqual(requests, [], "import made an HTTP(S) request");
      assert.deepEqual(result, { cookies: 1, localStorage: 2, skipped: 4 });
      assert.deepEqual(await page.executeJavaScript("[localStorage.getItem('keep'), localStorage.getItem('site')]"), ["existing", literal]);
      await page.loadURL(second);
      assert.deepEqual(await page.executeJavaScript("[localStorage.getItem('keep'), localStorage.getItem('site')]"), [null, "second"]);
      const savedCookie = (await target.cookies.get({ url: cookie.url }))[0];
      assert.ok(savedCookie?.hostOnly && savedCookie.secure && savedCookie.httpOnly);
      assert.equal(savedCookie.sameSite, "strict");
      assert.equal(savedCookie.value, "saved");
      const otherPage = newView(session.defaultSession);
      await otherPage.loadURL(first);
      assert.equal(await otherPage.executeJavaScript("localStorage.getItem('site')"), null);
      assert.deepEqual(await session.defaultSession.cookies.get({ url: cookie.url }), []);
      console.log("PASS offline site-data import, rejected items, cookie attributes, and origin and partition isolation");
    } catch (error) {
      status = 1;
      console.error(error);
    } finally {
      for (const view of views) view.webContents.close();
      for (const server of servers) if (server.listening) server.close();
      clearTimeout(watchdog);
      app.exit(status);
    }
  }
  void run();
}
