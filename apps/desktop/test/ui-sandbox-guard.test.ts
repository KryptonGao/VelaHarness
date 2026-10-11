import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allowSubframeNavigation } from "../src/main/ui-sandbox-guard.ts";

describe("allowSubframeNavigation", () => {
  it("lets the main frame navigate under its own rules", () => {
    assert.equal(allowSubframeNavigation("https://example.com/", true), true);
    assert.equal(allowSubframeNavigation("file:///app/index.html", true), true);
  });

  it("keeps micro-app frames on their inline document", () => {
    assert.equal(allowSubframeNavigation("about:srcdoc", false), true);
    assert.equal(allowSubframeNavigation("about:blank", false), true);
  });

  it("blocks every attempt to send a micro-app frame elsewhere", () => {
    for (const url of ["https://example.com/", "http://127.0.0.1:3000/", "file:///etc/passwd", "javascript:alert(1)", "data:text/html,<script>1</script>", "blob:https://x/1", "about:srcdoc#x", "about:blank?x", "", "ABOUT:SRCDOC"]) {
      assert.equal(allowSubframeNavigation(url, false), false, url);
    }
  });
});
