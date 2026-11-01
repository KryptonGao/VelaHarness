import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setActiveLocale } from "../src/renderer/locale.ts";
import { describeBrowserError, isLocalBrowserUrl, netErrorName } from "../src/renderer/browser/browser-error.ts";

describe("browser error descriptions", () => {
  setActiveLocale("en");
  it("extracts the Chromium error name from either format", () => {
    assert.equal(netErrorName("ERR_NAME_NOT_RESOLVED"), "ERR_NAME_NOT_RESOLVED");
    assert.equal(netErrorName("Error: ERR_CONNECTION_REFUSED (-102) loading 'http://localhost:1/'"), "ERR_CONNECTION_REFUSED");
    assert.equal(netErrorName("boom"), null);
    assert.equal(netErrorName(undefined), null);
  });
  it("explains common failures and keeps the technical code", () => {
    const dns = describeBrowserError({ code: "load-failed", detail: "ERR_NAME_NOT_RESOLVED", url: "https://nope.example/" });
    assert.equal(dns.title, "Can't find the server");
    assert.equal(dns.technical, "ERR_NAME_NOT_RESOLVED");
    assert.equal(describeBrowserError({ code: "load-failed", detail: "ERR_CERT_DATE_INVALID" }).title, "The connection isn't secure");
    assert.equal(describeBrowserError({ code: "load-failed", detail: "ERR_CONNECTION_TIMED_OUT" }).title, "The connection timed out");
    assert.equal(describeBrowserError({ code: "load-failed", detail: "ERR_INTERNET_DISCONNECTED" }).title, "You're offline");
    assert.equal(describeBrowserError({ code: "renderer-gone" }).title, "The page crashed");
  });
  it("tells a local refused connection to start the dev server", () => {
    const local = describeBrowserError({ code: "load-failed", detail: "ERR_CONNECTION_REFUSED", url: "http://localhost:5173/" });
    const remote = describeBrowserError({ code: "load-failed", detail: "ERR_CONNECTION_REFUSED", url: "https://example.com/" });
    assert.match(local.hint, /dev server/);
    assert.doesNotMatch(remote.hint, /dev server/);
    assert.ok(isLocalBrowserUrl("http://127.0.0.1:3000/") && isLocalBrowserUrl("http://app.localhost/") && !isLocalBrowserUrl("https://example.com"));
  });
  it("falls back to a generic message for unknown failures", () => {
    const unknown = describeBrowserError({ code: "load-failed", detail: "ERR_SOMETHING_NEW" });
    assert.equal(unknown.title, "Failed to load page");
    assert.equal(unknown.technical, "ERR_SOMETHING_NEW");
    assert.equal(describeBrowserError({ code: "load-failed" }).technical, null);
  });
});
