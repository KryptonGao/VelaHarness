import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { UiStorage } from "../src/main/ui-storage.ts";
import { createFileTabStore, fileTabsStorageKey } from "../src/renderer/components/preview/file-tab-persistence.ts";

const alpha = "/workspace/alpha";
const beta = "/workspace/beta";
const describeFile = (path: string) => ({ id: path, path, name: path.split("/").at(-1)!, dir: path.split("/").slice(0, -1).join("/") });

test("open file identities survive restart; replaced and closed files do not return", () => {
  const directory = mkdtempSync(join(tmpdir(), "vela-file-tabs-"));
  const file = join(directory, "ui-state.json");
  try {
    const disk = new UiStorage(file);
    const store = createFileTabStore(disk);
    store.update("", () => [describeFile("startup-only.ts")]);
    assert.equal(disk.getItem(fileTabsStorageKey), undefined);
    store.update(alpha, () => [{ ...describeFile("src/main.ts"), content: "not durable", scrollTop: 471, jumpLine: 32 }]);
    store.update(alpha, files => [...files, describeFile("README.md")]);
    store.update(beta, () => [describeFile("src/main.ts")]);
    const restart = () => createFileTabStore(new UiStorage(file));
    assert.deepEqual(JSON.parse(disk.getItem(fileTabsStorageKey)!), {
      [alpha]: ["src/main.ts", "README.md"], [beta]: ["src/main.ts"],
    });
    const restored = restart();
    assert.deepEqual(restored.getTabs()[alpha], [describeFile("src/main.ts"), describeFile("README.md")]);
    assert.equal(restored.getTabs()[""], undefined);

    restored.update(alpha, files => files.map(tab => tab.id === "src/main.ts" ? describeFile("src/other.ts") : tab));
    restored.update(alpha, files => files.filter(tab => tab.id !== "README.md"));
    assert.deepEqual(restart().getTabs()[alpha], [describeFile("src/other.ts")]);
    restored.update(alpha, () => []);
    const final = restart().getTabs();
    assert.equal(final[alpha], undefined);
    assert.deepEqual(final[beta], [describeFile("src/main.ts")]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("invalid saved entries do not leak across workspaces or prevent opening a file", () => {
  let value = "malformed";
  let writes = 0;
  const storage = { getItem: () => value, setItem: (_key: string, next: string) => { value = next; writes += 1; } };
  assert.deepEqual(Object.keys(createFileTabStore(storage).getTabs()), []);
  assert.equal(writes, 0);
  value = JSON.stringify({
    [alpha]: ["src/main.ts", "src/main.ts", { path: "secret.txt" }, null, "", "../beta/index.ts", "bad\0file", "\ud800", "\\windows", "/"],
    [beta]: false,
    "": ["unscoped.ts"],
  });
  assert.deepEqual({ ...createFileTabStore(storage).getTabs() }, { [alpha]: [describeFile("src/main.ts")] });
  const store = createFileTabStore({ getItem: () => { throw Error("unreadable"); }, setItem: () => { throw Error("unwritable"); } });
  assert.deepEqual(store.update(beta, () => [describeFile("index.ts")])[beta], [describeFile("index.ts")]);
});

test("provider starts with the host's workspace tabs without reporting opens or closes", async () => {
  const server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)), configFile: false,
    esbuild: { jsx: "automatic" }, server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true },
  });
  try {
    const { FilePreviewProvider, useFilePreview } = await server.ssrLoadModule("/src/renderer/components/preview/FilePreviewContext.tsx") as typeof import("../src/renderer/components/preview/FilePreviewContext.tsx");
    const store = createFileTabStore({
      getItem: () => JSON.stringify({ [alpha]: ["src/main.ts", "README.md"], [beta]: ["config.json"] }),
      setItem: () => assert.fail("hydration does not persist"),
    });
    let reported = 0;
    function TabProbe() {
      const preview = useFilePreview()!;
      assert.equal(preview.activeContent, null);
      assert.ok(preview.tabs.every(tab => tab.jumpLine === null));
      return createElement("div", null, preview.tabs.map(tab => tab.id).join(","));
    }
    const render = (workspaceKey: string) => renderToStaticMarkup(createElement(FilePreviewProvider, {
      workspaceKey, workspaceTabs: store.getTabs()[workspaceKey], children: createElement(TabProbe),
      onOpenFile: () => { reported += 1; }, onCloseFileTab: () => { reported += 1; }, onCloseAllFileTabs: () => { reported += 1; },
    }));
    assert.equal(render(alpha), "<div>src/main.ts,README.md</div>");
    assert.equal(render(beta), "<div>config.json</div>");
    assert.equal(render("/workspace/unknown"), "<div></div>");
    assert.equal(reported, 0);
  } finally {
    await server.close();
  }
});
