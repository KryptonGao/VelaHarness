import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyChatImageSrc, replyUrlTransform } from "../src/renderer/components/markdown-image-src.ts";

describe("classifyChatImageSrc", () => {
  it("keeps network and data images as they are", () => {
    assert.deepEqual(classifyChatImageSrc("https://example.com/a.png"), { kind: "remote", src: "https://example.com/a.png" });
    assert.deepEqual(classifyChatImageSrc("data:image/png;base64,AAAA"), { kind: "remote", src: "data:image/png;base64,AAAA" });
  });

  it("treats paths as workspace files", () => {
    assert.deepEqual(classifyChatImageSrc("docs/shot.png"), { kind: "file", path: "docs/shot.png" });
    assert.deepEqual(classifyChatImageSrc("/tmp/out/chart.png"), { kind: "file", path: "/tmp/out/chart.png" });
    assert.deepEqual(classifyChatImageSrc("C:\\Users\\me\\a.png"), { kind: "file", path: "C:/Users/me/a.png" });
  });

  it("decodes percent-encoded names and drops query and hash", () => {
    assert.deepEqual(classifyChatImageSrc("docs/%E6%88%AA%E5%9B%BE.png?v=2#top"), { kind: "file", path: "docs/截图.png" });
    assert.deepEqual(classifyChatImageSrc("docs/100%.png"), { kind: "file", path: "docs/100%.png" });
  });

  it("reads local file URLs and rejects remote hosts", () => {
    assert.deepEqual(classifyChatImageSrc("file:///Users/me/a%20b.png"), { kind: "file", path: "/Users/me/a b.png" });
    assert.deepEqual(classifyChatImageSrc("file:///C:/x/a.png"), { kind: "file", path: "C:/x/a.png" });
    assert.deepEqual(classifyChatImageSrc("file://server/share/a.png"), { kind: "none" });
  });

  it("rejects other schemes, non-image data and empty input", () => {
    for (const value of ["javascript:alert(1)", "blob:https://x/1", "data:text/html;base64,AAAA", "", "  ", "a\0.png"]) {
      assert.deepEqual(classifyChatImageSrc(value), { kind: "none" }, value);
    }
  });
});

describe("replyUrlTransform", () => {
  const safeLink = (url: string) => (url.startsWith("https:") ? url : "");

  it("only opens up image sources", () => {
    assert.equal(replyUrlTransform("/tmp/a.png", "src", safeLink), "/tmp/a.png");
    assert.equal(replyUrlTransform("javascript:alert(1)", "src", safeLink), "");
    assert.equal(replyUrlTransform("/tmp/a.png", "href", safeLink), "");
    assert.equal(replyUrlTransform("https://example.com", "href", safeLink), "https://example.com");
  });
});
