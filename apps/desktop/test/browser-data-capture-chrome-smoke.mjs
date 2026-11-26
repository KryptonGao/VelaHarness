/** Run with node --experimental-strip-types apps/desktop/test/browser-data-capture-chrome-smoke.mjs.
 * Requires the installed Chrome channel. Uses only newly launched private contexts and a loopback fixture.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mock } from "node:test";
import { chromium } from "playwright-core";
import { captureChromeData } from "../src/main/browser-data-capture.ts";

const server = createServer((_request, response) => {
  response.setHeader("Content-Type", "text/html");
  response.setHeader("Set-Cookie", "capture_fixture=local; Path=/; SameSite=Lax; HttpOnly");
  response.end("<!doctype html><title>Local import test</title><script>localStorage.setItem('theme','dark')</script>");
});
const active = new Set();
const controller = new AbortController();
const watchdog = setTimeout(() => controller.abort(), 35_000);
try {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let firstPage;
  const pageStarted = new Promise(resolve => { firstPage = resolve; });
  const launch = chromium.launch.bind(chromium);
  let snapshots = 0;
  mock.method(chromium, "launch", async options => {
    assert.equal(options.channel, "chrome");
    assert.equal(options.headless, false);
    assert.equal(options.chromiumSandbox, true);
    const browser = await launch(options);
    active.add(browser);
    const newContext = browser.newContext.bind(browser);
    mock.method(browser, "newContext", async options => {
      const context = await newContext(options);
      const storageState = context.storageState.bind(context);
      mock.method(context, "storageState", options => {
        snapshots++;
        assert.deepEqual(options, { indexedDB: false, opfs: false, credentials: false });
        return storageState(options);
      });
      context.once("page", page => firstPage(page));
      return context;
    });
    return browser;
  });

  const capture = captureChromeData(controller.signal);
  const page = await Promise.race([pageStarted, capture.then(() => { throw Error("No Chrome import page opened"); })]);
  const context = page.context();
  assert.deepEqual(await context.cookies(), [], "fresh Chrome context already contained cookies");
  await page.goto(origin);
  const second = await context.newPage();
  await page.close();
  assert.ok(context.browser().isConnected());
  await second.close();
  const state = await capture;
  assert.ok(state);
  assert.equal(snapshots, 1);
  assert.ok(state.cookies.some(row => row.name === "capture_fixture" && row.httpOnly && row.value === "local"));
  assert.deepEqual(state.origins.find(entry => entry.origin === origin)?.localStorage, [{ name: "theme", value: "dark" }]);
  assert.ok([...active].every(browser => !browser.isConnected()));
  console.log("PASS installed Chrome opens an isolated context and captures cookie and LocalStorage after its last tab closes");
} finally {
  controller.abort();
  clearTimeout(watchdog);
  await Promise.all([...active].map(browser => browser.close()));
  mock.restoreAll();
  server.closeAllConnections();
  server.close();
}
