import type { Browser, BrowserContext } from "playwright-core";

type ChromeStorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

/** Opens a fresh, visible Chrome session. Closing its last page finishes the import. */
export async function captureChromeData(signal: AbortSignal): Promise<ChromeStorageState | null> {
  if (signal.aborted) return null;
  let browser: Browser;
  try {
    const { chromium } = await import("playwright-core");
    if (signal.aborted) return null;
    browser = await chromium.launch({
      channel: "chrome", headless: false, chromiumSandbox: true, timeout: 20_000,
      handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false,
    });
  } catch (error) {
    if (signal.aborted) return null;
    const missing = error instanceof Error && error.message.includes("Chromium distribution 'chrome' is not found");
    throw new Error(missing ? "BROWSER_CHROME_UNAVAILABLE" : "BROWSER_CHROME_FAILED");
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  let ending = false;
  let state: ChromeStorageState | null;
  try {
    if (signal.aborted) return null;
    state = await new Promise<ChromeStorageState | null>((resolve, reject) => {
      const fail = () => reject(new Error("BROWSER_CHROME_FAILED"));
      onAbort = () => resolve(null);
      signal.addEventListener("abort", onAbort, { once: true });
      browser.once("disconnected", fail);
      if (!browser.isConnected()) { fail(); return; }
      timer = setTimeout(fail, 20_000);
      void browser.newContext({ viewport: null, acceptDownloads: false }).then(async context => {
        if (ending || signal.aborted) return;
        let collecting = false;
        context.once("close", fail);
        context.on("page", page => {
          // Leave native dialogs open for the user, just as Playwright's open command does.
          page.on("dialog", () => {});
          page.once("close", () => {
            if (ending || collecting || signal.aborted || context.pages().length !== 0) return;
            // storageState may briefly create its own page to read a closed site's storage.
            collecting = true;
            clearTimeout(timer);
            timer = setTimeout(fail, 30_000);
            void context.storageState({ indexedDB: false, opfs: false, credentials: false }).then(resolve, fail);
          });
        });
        await context.newPage();
        if (!collecting) clearTimeout(timer);
      }).catch(fail);
    });
  } finally {
    ending = true;
    clearTimeout(timer);
    if (onAbort) signal.removeEventListener("abort", onAbort);
    // Closing our browser also disposes its nonpersistent context and temporary profile.
    await browser.close().catch(() => undefined);
  }
  return signal.aborted ? null : state;
}
