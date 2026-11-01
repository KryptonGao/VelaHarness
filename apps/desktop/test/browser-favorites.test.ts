import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isFaviconUrl } from "../src/browser-policy.ts";
import { parseFavorites } from "../src/renderer/browser/favorites-store.ts";

describe("browser favorites", () => {
  it("keeps valid entries and drops duplicates, blank pages and other schemes", () => {
    const raw = JSON.stringify([
      { url: "https://apple.com/", title: "Apple", favicon: "https://apple.com/favicon.ico" },
      { url: "https://apple.com/", title: "Again" },
      { url: "about:blank", title: "Blank" },
      { url: "file:///etc/passwd", title: "Local" },
      { url: "https://example.com/", title: 5, favicon: "javascript:alert(1)" },
      "nope",
    ]);
    assert.deepEqual(parseFavorites(raw), [
      { url: "https://apple.com/", title: "Apple", favicon: "https://apple.com/favicon.ico" },
      { url: "https://example.com/", title: "" },
    ]);
  });
  it("falls back to an empty list on bad input", () => {
    assert.deepEqual(parseFavorites(null), []);
    assert.deepEqual(parseFavorites("{"), []);
    assert.deepEqual(parseFavorites('{"url":"https://a.com"}'), []);
  });
  it("only accepts http(s) and data:image favicons", () => {
    assert.equal(isFaviconUrl("https://a.com/i.png"), true);
    assert.equal(isFaviconUrl("data:image/png;base64,AAAA"), true);
    assert.equal(isFaviconUrl("javascript:alert(1)"), false);
    assert.equal(isFaviconUrl("file:///a.png"), false);
    assert.equal(isFaviconUrl("about:blank"), false);
  });
});
