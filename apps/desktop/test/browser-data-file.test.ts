import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getImportSites, parseBrowserData, selectBrowserData } from "../src/main/browser-data-file.ts";

function cookie(domain: string, overrides: Record<string, unknown> = {}) {
  return { name: "layout", value: "compact", domain, path: "/", secure: true, httpOnly: true,
    sameSite: "Lax", expires: -1, ...overrides };
}

function origin(url: string, name = "theme", value = "dark") {
  return { origin: url, localStorage: [{ name, value }] };
}

describe("Chrome storage state import", () => {
  it("lists hostnames once and filters exact hosts while preserving storage origins", () => {
    const staged = parseBrowserData({
      cookies: [cookie(".EXAMPLE.test"), cookie("login.example.test"), cookie("localhost")],
      origins: [origin("https://example.test"), origin("http://example.test:8000"), origin("http://[::1]:3001"),
        origin("https://example.test.evil.test"), { origin: "https://empty.test", localStorage: [] }],
    });
    assert.deepEqual(getImportSites(staged), ["[::1]", "example.test", "example.test.evil.test", "localhost", "login.example.test"]);
    const selected = selectBrowserData(staged, ["example.test"]);
    assert.deepEqual(selected.origins, [origin("https://example.test"), origin("http://example.test:8000")]);
    assert.deepEqual(selected.cookies.map(row => row.domain), [".example.test"]);
    const all = selectBrowserData(staged, null);
    assert.equal(all.cookies.length, 3);
    assert.equal(all.origins.length, 4);
    assert.equal(all.skipped, 0);
    assert.deepEqual(selectBrowserData(staged, ["[::1]", "localhost"]).origins, [origin("http://[::1]:3001")]);
  });

  it("preserves host-only and session flags, domain paths, expiry, Secure, HttpOnly and SameSite", () => {
    const expiry = Math.floor(Date.now() / 1000) + 7200;
    const staged = parseBrowserData({ cookies: [
      cookie("one.test", { secure: false, httpOnly: false, sameSite: "Strict" }),
      cookie(".two.test", { path: "/app", expires: expiry, sameSite: "None" }),
    ], origins: [] });
    assert.deepEqual(selectBrowserData(staged, null).cookies, [
      { url: "http://one.test/", name: "layout", value: "compact", path: "/", secure: false, httpOnly: false, sameSite: "strict" },
      { url: "https://two.test/", name: "layout", value: "compact", path: "/app", domain: ".two.test", secure: true,
        httpOnly: true, sameSite: "no_restriction", expirationDate: expiry },
    ]);
  });

  it("skips expired, malformed and partitioned rows without broadening their scope", () => {
    const staged = parseBrowserData({ cookies: [
      cookie("shop.test", { expires: 1 }), cookie("shop.test", { partitionKey: "https://another.test" }),
      cookie("shop.test", { sameSite: "anything" }), cookie("shop.test", { secure: "true" }),
      cookie("shop.test", { httpOnly: undefined }), cookie("shop.test", { path: "home" }), cookie("other.test"),
      cookie("other.test", { value: "a\nb" }), cookie("https://bad.test"), null,
    ], origins: [
      { origin: "https://shop.test", localStorage: [null, { name: "toString", value: "" }] },
      { ...origin("https://shop.test"), storageKey: "different partition" },
      origin("file:///tmp/foo"), origin("https://user:pw@wrong.test"), origin("https://wrong.test/path"),
      origin("https://bad..hostname"), origin("https://example.test\\@wrong.test"), origin("https://0x7f000001"),
    ] });
    const shop = selectBrowserData(staged, ["shop.test"]);
    assert.deepEqual(shop.cookies, []);
    assert.deepEqual(shop.origins, [origin("https://shop.test", "toString", "")]);
    assert.equal(shop.skipped, 8);
    assert.deepEqual(getImportSites(staged), ["other.test", "shop.test"]);
    assert.equal(selectBrowserData(staged, ["other.test"]).skipped, 1);
    assert.equal(selectBrowserData(staged, null).skipped, 17);
  });

  it("keeps arbitrary LocalStorage keys and strings as data", () => {
    const rows = [
      origin("HTTPS://CONSTRUCTOR:443/", "__proto__", "null"),
      origin("http://localhost:3020", "", '</script>\u0000"'),
    ];
    const staged = parseBrowserData({ cookies: [], origins: rows });
    assert.deepEqual(getImportSites(staged), ["constructor", "localhost"]);
    const imported = selectBrowserData(staged, null);
    assert.deepEqual(imported.origins, [{ ...rows[0], origin: "https://constructor" }, rows[1]]);
    assert.equal(imported.skipped, 0);
  });

  it("rejects unsupported files, excessive records and invalid selections", () => {
    for (const value of [null, [], {}, { cookies: [{}] }, { cookies: [], origins: {} }]) {
      assert.throws(() => parseBrowserData(value), /Invalid browser storage state/);
    }
    assert.throws(() => parseBrowserData({ cookies: [], origins: [
      { origin: "https://example.test", localStorage: Array(100_000).fill(null) },
    ] }), /too large/);
    const staged = parseBrowserData({ cookies: [cookie("good.test")], origins: [] });
    for (const selected of [[], ["GOOD.TEST"], ["https://good.test"], ["unlisted.test"], ["__proto__"], Array(1)]) {
      assert.throws(() => selectBrowserData(staged, selected), /Invalid browser site selection/);
    }
    assert.deepEqual(selectBrowserData(parseBrowserData({ cookies: [], origins: [] }), null),
      { cookies: [], origins: [], skipped: 0 });
  });
});
