import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { WorkspaceHtmlPreview } from "../src/main/html-preview.ts";

test("preview URLs preserve document directories and only serve workspace web assets", async t => {
  const temp = await mkdtemp(join(tmpdir(), "vela-preview-assets-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const root = join(temp, "site");
  const page = join(root, "pages", "a #一.html");
  await mkdir(join(root, "pages"), { recursive: true });
  await writeFile(page, "<!doctype html><title>Hello</title>");
  await writeFile(join(root, "main.css"), "body { color: red }");
  await writeFile(join(temp, "outside.html"), "outside");
  await symlink(join(temp, "outside.html"), join(root, "link.html"));
  await writeFile(join(root, ".private.json"), "{}");
  await writeFile(join(root, "notes.txt"), "text");

  const preview = new WorkspaceHtmlPreview();
  const url = await preview.documentUrl(page, [root], 36);
  assert.ok(url);
  const get = (path: string) => preview.serve(new Request(new URL(path, url)));
  assert.ok(preview.isDocumentUrl(url));
  assert.equal(await (await get(url)).text(), "<!doctype html><title>Hello</title>");
  const css = await get("../main.css?v=2#x");
  assert.match(css.headers.get("Content-Type")!, /^text\/css/);
  assert.equal(await css.text(), "body { color: red }");
  assert.equal(await preview.documentUrl(join(temp, "outside.html"), [root], 7), undefined);
  assert.equal(await preview.documentUrl(join(root, "link.html"), [root], 7), undefined);
  assert.equal(await preview.documentUrl(page, [root], 17 * 1024 * 1024), undefined);
  for (const path of ["/link.html", "/.private.json", "/notes.txt", "/missing.png", "/..%2foutside.html", "/..%5coutside.html", "/%ZZ.css"]) {
    assert.equal((await get(path)).status, 404, path);
  }
  assert.equal((await preview.serve(new Request(url, { method: "POST" }))).status, 405);
  const nextWorkspace = new WorkspaceHtmlPreview();
  assert.equal(nextWorkspace.isDocumentUrl(url), false);
  assert.equal((await nextWorkspace.serve(new Request(url))).status, 404);
});
