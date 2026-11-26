import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { chromium } from "playwright-core";
import { captureChromeData } from "../src/main/browser-data-capture.ts";

test("reports a missing installed Chrome distinctly and redacts other launch errors", async t => {
  const launch = t.mock.method(chromium, "launch", async () => {
    throw new Error("Chromium distribution 'chrome' is not found at /example/private/chrome");
  });
  await assert.rejects(captureChromeData(new AbortController().signal), { message: "BROWSER_CHROME_UNAVAILABLE" });
  launch.mock.mockImplementation(async () => { throw new Error("Private browser diagnostic"); });
  await assert.rejects(captureChromeData(new AbortController().signal), { message: "BROWSER_CHROME_FAILED" });
});

test("cancelling before launch avoids Chrome and cancelling during launch closes the owned browser", async t => {
  const started = Promise.withResolvers<void>();
  const launched = Promise.withResolvers<unknown>();
  const launch = t.mock.method(chromium, "launch", () => {
    started.resolve();
    return launched.promise;
  });
  assert.equal(await captureChromeData(AbortSignal.abort()), null);
  assert.equal(launch.mock.callCount(), 0);
  const controller = new AbortController();
  const capture = captureChromeData(controller.signal);
  await started.promise;
  controller.abort();
  const close = t.mock.fn(async () => {});
  launched.resolve({ close });
  assert.equal(await capture, null);
  assert.equal(close.mock.callCount(), 1);
});

for (const interruption of ["cancel", "disconnect"]) {
  test(`${interruption} during context creation settles the capture and releases Chrome`, async t => {
    const creating = Promise.withResolvers<void>();
    const context = Promise.withResolvers<unknown>();
    const close = t.mock.fn(async () => { context.reject(new Error("Fixture browser closed")); });
    const browser = Object.assign(new EventEmitter(), {
      isConnected: () => true,
      newContext: () => { creating.resolve(); return context.promise; },
      close,
    });
    t.mock.method(chromium, "launch", async () => browser);
    const controller = new AbortController();
    const capture = captureChromeData(controller.signal);
    await creating.promise;
    if (interruption === "cancel") {
      controller.abort();
      assert.equal(await capture, null);
    } else {
      browser.emit("disconnected");
      await assert.rejects(capture, { message: "BROWSER_CHROME_FAILED" });
    }
    assert.equal(close.mock.callCount(), 1);
  });
}
