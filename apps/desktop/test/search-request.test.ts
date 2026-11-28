import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSearchQuery, snippetSegments } from "@vela/shared";
import { parseRequestId, parseSearchRequest } from "../src/main/search-request.ts";

describe("parseSearchRequest", () => {
  it("keeps the known fields and defaults the switches to on", () => {
    assert.deepEqual(parseSearchRequest({ query: "npm", filters: {} }), { query: "npm", filters: { includeArchived: true, includeTools: true } });
    assert.deepEqual(
      parseSearchRequest({ query: "x", after: 12, filters: { workspace: "", from: 1, to: 2, includeArchived: false, includeTools: false, extra: 1 }, other: true }),
      { query: "x", after: 12, filters: { workspace: "", from: 1, to: 2, includeArchived: false, includeTools: false } },
    );
  });

  it("drops values of the wrong type and limits the query length", () => {
    const parsed = parseSearchRequest({ query: "a".repeat(5000), after: "1", filters: { workspace: 3, from: Number.NaN, to: Infinity } });
    assert.equal(parsed.query.length, 1000);
    assert.deepEqual(parsed, { query: "a".repeat(1000), filters: { includeArchived: true, includeTools: true } });
  });

  it("rejects a request without a query string", () => {
    assert.throws(() => parseSearchRequest({ filters: {} }));
    assert.throws(() => parseSearchRequest(null));
  });

  it("accepts only short string request ids", () => {
    assert.equal(parseRequestId("abc"), "abc");
    assert.throws(() => parseRequestId(""));
    assert.throws(() => parseRequestId(7));
    assert.throws(() => parseRequestId("x".repeat(65)));
  });
});

describe("parseSearchQuery", () => {
  it("splits on spaces and keeps quoted text together", () => {
    assert.deepEqual(parseSearchQuery("  npm   ERR  "), ["npm", "ERR"]);
    assert.deepEqual(parseSearchQuery('git "push origin" main'), ["git", "push origin", "main"]);
    assert.deepEqual(parseSearchQuery('"unterminated phrase'), ["unterminated", "phrase"]);
  });

  it("drops empty and repeated keywords and caps the count", () => {
    assert.deepEqual(parseSearchQuery('"" a a'), ["a"]);
    assert.deepEqual(parseSearchQuery("   "), []);
    assert.equal(parseSearchQuery("a b c d e f g h i j").length, 8);
  });
});

describe("snippetSegments", () => {
  it("alternates plain and matched text", () => {
    assert.deepEqual(snippetSegments("no \u0001ERR\u0002 here \u0001x\u0002"), [
      { text: "no ", match: false }, { text: "ERR", match: true }, { text: " here ", match: false }, { text: "x", match: true },
    ]);
    assert.deepEqual(snippetSegments("\u0001all\u0002"), [{ text: "all", match: true }]);
    assert.deepEqual(snippetSegments("plain"), [{ text: "plain", match: false }]);
  });
});
