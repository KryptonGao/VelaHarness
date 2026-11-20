import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer, type ViteDevServer } from "vite";

const rendererDir = fileURLToPath(new URL("../src/renderer/", import.meta.url));

/** 允许直接写 <svg> 的文件：Logo、插画、图表、进度环等不是界面图标的图形。界面图标一律走 <Icon>。 */
const SVG_ALLOWLIST: Record<string, string> = {
  "components/VelaLogo.tsx": "logo",
  "components/OrbCanvas.tsx": "illustration",
  "components/OnboardingIntro.tsx": "onboarding illustration",
  "components/onboarding-art.tsx": "onboarding illustration",
  "components/NewChatHome.tsx": "home logo illustration",
  "components/IntegrationsSection.tsx": "third-party brand logos",
  "components/settings/MarketplaceIcon.tsx": "third-party brand logos",
  "components/settings/display-previews.tsx": "display setting previews",
  "components/settings/ThemeGroup.tsx": "theme previews",
  "components/intelligent-ui/charts.tsx": "charts",
  "components/intelligent-ui/diagrams.tsx": "diagrams",
  "components/intelligent-ui/rich-views.tsx": "plots",
  "components/version-control/CommitGraph.tsx": "commit graph",
  "components/composer/ComposerStatsRow.tsx": "progress ring",
  "components/NavUsageRing.tsx": "quota progress ring",
  "components/UsageLimitMenu.tsx": "progress ring",
  "components/ModelControls.tsx": "thinking dial",
  "components/browser/BrowserAgentPointer.tsx": "agent cursor",
};

function rendererSources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = `${dir}${name}`;
    if (statSync(full).isDirectory()) rendererSources(`${full}/`, out);
    else if (name.endsWith(".tsx")) out.push(full.slice(rendererDir.length));
  }
  return out;
}

const svgDir = fileURLToPath(new URL("../src/renderer/components/icons/svg/", import.meta.url));

let server: ViteDevServer;
let registry: typeof import("../src/renderer/components/icons/registry.generated.ts");
let icons: typeof import("../src/renderer/components/icons/index.ts");
let classic: typeof import("../src/renderer/components/icons/classic-glyphs.ts");
let preference: typeof import("../src/renderer/hooks/useUnifiedIcons.ts");

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
  classic = await server.ssrLoadModule("/src/renderer/components/icons/classic-glyphs.ts");
  preference = await server.ssrLoadModule("/src/renderer/hooks/useUnifiedIcons.ts");
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

  it("keeps interface icons out of hand-written <svg> elements", () => {
    const withSvg = rendererSources(rendererDir)
      .filter((file) => !file.startsWith("components/icons/"))
      .filter((file) => readFileSync(`${rendererDir}${file}`, "utf8").includes("<svg"));
    const unexpected = withSvg.filter((file) => !(file in SVG_ALLOWLIST));
    assert.deepEqual(unexpected, [], "interface icons must use <Icon>; add real illustrations to SVG_ALLOWLIST with a reason");
    const stale = Object.keys(SVG_ALLOWLIST).filter((file) => !withSvg.includes(file));
    assert.deepEqual(stale, [], "SVG_ALLOWLIST lists files that no longer contain <svg>");
  });

  it("never hard-codes a colour, so icons follow the surrounding text colour", () => {
    for (const [name, entry] of Object.entries(registry.iconRegistry)) {
      for (const body of [entry.line, entry.fill ?? ""]) {
        assert.doesNotMatch(body, /#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i, `${name} hard-codes a colour`);
      }
    }
  });

  it("renders an inline svg that inherits currentColor at the requested size", () => {
    const html = renderToStaticMarkup(createElement(icons.Icon, { name: "clock", size: 16, variant: "unified" }));
    assert.match(html, /^<svg [^>]*width="16"[^>]*height="16"[^>]*viewBox="0 0 24 24"/);
    assert.match(html, /aria-hidden="true"/);
    assert.match(html, /currentColor/);
    assert.ok(html.includes(registry.iconRegistry.clock.line));
  });

  it("defaults to 14px and switches to the filled variant on request", () => {
    const line = renderToStaticMarkup(createElement(icons.Icon, { name: "star", variant: "unified" }));
    const filled = renderToStaticMarkup(createElement(icons.Icon, { name: "star", filled: true, variant: "unified" }));
    assert.match(line, /width="14"/);
    assert.ok(registry.iconRegistry.star.fill);
    assert.ok(filled.includes(registry.iconRegistry.star.fill));
    assert.notEqual(line, filled);
  });

  it("falls back to the line variant when an icon has no filled version", () => {
    const html = renderToStaticMarkup(createElement(icons.Icon, { name: "clock", filled: true, variant: "unified" }));
    const expected = registry.iconRegistry.clock.fill ?? registry.iconRegistry.clock.line;
    assert.ok(html.includes(expected));
  });

  it("is off by default and renders the original icons", () => {
    assert.equal(preference.getUnifiedIcons(), false);
    const html = renderToStaticMarkup(createElement(icons.Icon, { name: "clock" }));
    assert.ok(html.includes(classic.classicGlyphs.clock.line));
    assert.ok(!html.includes(registry.iconRegistry.clock.line));
  });

  it("switches to the MingCute icons when the setting is turned on", () => {
    preference.setUnifiedIcons(true);
    try {
      const html = renderToStaticMarkup(createElement(icons.Icon, { name: "clock" }));
      assert.ok(html.includes(registry.iconRegistry.clock.line));
      assert.ok(!html.includes(classic.classicGlyphs.clock.line));
    } finally {
      preference.setUnifiedIcons(false);
    }
    assert.ok(renderToStaticMarkup(createElement(icons.Icon, { name: "clock" })).includes(classic.classicGlyphs.clock.line));
  });

  it("has an original glyph for every icon", () => {
    assert.deepEqual(Object.keys(classic.classicGlyphs).sort(), Object.keys(registry.iconRegistry).sort());
    for (const [name, glyph] of Object.entries(classic.classicGlyphs)) {
      assert.ok(glyph.line.length > 0, `${name} has no classic glyph`);
      assert.doesNotMatch(glyph.line, /#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i, `${name} classic glyph hard-codes a colour`);
    }
  });

  it("snaps arbitrary pixel sizes up to the nearest allowed size", () => {
    const snap = icons.snapIconSize;
    assert.deepEqual([9, 10, 11, 13, 15, 17, 22, 26, 40].map(snap), [10, 10, 12, 14, 16, 18, 24, 28, 28]);
  });

  it("only allows a small fixed set of sizes", () => {
    assert.deepEqual([...icons.ICON_SIZES], [10, 12, 14, 16, 18, 20, 24, 28]);
  });
});
