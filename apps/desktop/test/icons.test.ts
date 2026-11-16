import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer, type ViteDevServer } from "vite";

const svgDir = fileURLToPath(new URL("../src/renderer/components/icons/svg/", import.meta.url));

let server: ViteDevServer;
let registry: typeof import("../src/renderer/components/icons/registry.generated.ts");
let icons: typeof import("../src/renderer/components/icons/index.ts");

before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    configFile: false,
    esbuild: { jsx: "automatic" },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    optimizeDeps: { noDiscovery: true },
  });
  registry = await server.ssrLoadModule("/src/renderer/components/icons/registry.generated.ts");
  icons = await server.ssrLoadModule("/src/renderer/components/icons/index.ts");
});

after(async () => { await server?.close(); });

describe("interface icons", () => {
  it("keeps the registry and the svg directory in sync", () => {
    const files = readdirSync(svgDir).filter((file) => file.endsWith(".svg")).sort();
    const expected = Object.entries(registry.iconRegistry)
      .flatMap(([name, entry]) => entry.fill ? [`${name}.svg`, `${name}-fill.svg`] : [`${name}.svg`])
      .sort();
    assert.deepEqual(files, expected);
    for (const [name, entry] of Object.entries(registry.iconRegistry)) {
      const source = readFileSync(`${svgDir}${name}.svg`, "utf8");
      assert.ok(source.includes(entry.line), `${name}.svg differs from the registry; rerun scripts/sync-mingcute-icons.mjs`);
    }
  });

  it("never hard-codes a colour, so icons follow the surrounding text colour", () => {
    for (const [name, entry] of Object.entries(registry.iconRegistry)) {
      for (const body of [entry.line, entry.fill ?? ""]) {
        assert.doesNotMatch(body, /#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i, `${name} hard-codes a colour`);
      }
    }
  });

  it("renders an inline svg that inherits currentColor at the requested size", () => {
    const html = renderToStaticMarkup(createElement(icons.Icon, { name: "clock", size: 16 }));
    assert.match(html, /^<svg [^>]*width="16"[^>]*height="16"[^>]*viewBox="0 0 24 24"/);
    assert.match(html, /aria-hidden="true"/);
    assert.match(html, /currentColor/);
    assert.ok(html.includes(registry.iconRegistry.clock.line));
  });

  it("defaults to 14px and switches to the filled variant on request", () => {
    const line = renderToStaticMarkup(createElement(icons.Icon, { name: "star" }));
    const filled = renderToStaticMarkup(createElement(icons.Icon, { name: "star", filled: true }));
    assert.match(line, /width="14"/);
    assert.ok(registry.iconRegistry.star.fill);
    assert.ok(filled.includes(registry.iconRegistry.star.fill));
    assert.notEqual(line, filled);
  });

  it("falls back to the line variant when an icon has no filled version", () => {
    const html = renderToStaticMarkup(createElement(icons.Icon, { name: "clock", filled: true }));
    const expected = registry.iconRegistry.clock.fill ?? registry.iconRegistry.clock.line;
    assert.ok(html.includes(expected));
  });

  it("only allows a small fixed set of sizes", () => {
    assert.deepEqual([...icons.ICON_SIZES], [12, 14, 16, 18]);
  });
});
