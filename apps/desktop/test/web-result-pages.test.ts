import assert from "node:assert/strict";
import { test } from "node:test";
import { webResultPages } from "../src/renderer/components/web-result-pages.ts";

test("search chips keep result order, skip duplicate and unsafe URLs, and ignore snippet links", () => {
  const body = ['header', '<untrusted_web_content>', '1. First', '   URL: https://a.example', '   Summary: more', '   2. Not a result', '      URL: https://ignored.example', '2. Duplicate', '   URL: https://a.example/', '3. Unsafe', '   URL: file:///tmp/file', '4. Last', '   URL: https://b.example/doc', '</untrusted_web_content>'].join('\n');
  assert.deepEqual(webResultPages(false, body).map(p => [p.title, p.href]), [['First', 'https://a.example/'], ['Last', 'https://b.example/doc']]);
  assert.deepEqual(webResultPages(false, 'No results.'), []);
});

test("fetch chips use page metadata or the requested URL, never body links", () => {
  const body = 'Fetched https://example.org/final via Provider. Untrusted web content.\nTitle: Guide\n\n<untrusted_web_content>\nhttps://ignored.example';
  assert.deepEqual(webResultPages(true, body, 'https://example.org'), [{ href: 'https://example.org/final', title: 'Guide', host: 'example.org' }]);
  assert.equal(webResultPages(true, '', 'https://www.example.org')[0]?.title, 'example.org');
  assert.deepEqual(webResultPages(true, '', 'javascript:void(0)'), []);
});
