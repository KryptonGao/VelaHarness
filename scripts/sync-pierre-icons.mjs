#!/usr/bin/env node
// 从 @pierre/vscode-icons 的源码包生成应用内置的 Pierre 文件图标。
//
// 用法：
//   npm pack @pierre/vscode-icons@<版本> && mkdir up && tar -xzf pierre-vscode-icons-*.tgz -C up
//   node scripts/sync-pierre-icons.mjs up/package
//
// 取上游 Complete 档的配色（暗色用 400、亮色用 600），把 currentColor 写死成颜色，
// 每个图标输出 `<name>.svg`（暗色）和 `<name>-light.svg`（亮色），并生成
// `apps/desktop/src/renderer/components/pierre-file-icons.ts` 作为文件名/扩展名映射。
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const upstream = path.resolve(process.argv[2] ?? "");
if (!process.argv[2]) {
  console.error("Usage: node scripts/sync-pierre-icons.mjs <path to unpacked @pierre/vscode-icons>");
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assetDir = path.join(root, "apps/desktop/src/renderer/assets/pierre-icons");
const mappingFile = path.join(root, "apps/desktop/src/renderer/components/pierre-file-icons.ts");
const load = (file) => import(pathToFileURL(path.join(upstream, "scripts", file)).href).then((mod) => mod);

const { color, fill, palette } = await load("palette.mjs");
const minimal = (await load("themes/minimal.mjs")).default;
const defaults = (await load("themes/default.mjs")).default;
const complete = (await load("themes/complete.mjs")).default;
const version = JSON.parse(await readFile(path.join(upstream, "package.json"), "utf8")).version;

const icons = new Map();
for (const icon of [...minimal, ...defaults, ...complete]) icons.set(icon.name, icon);

// 上游 Complete 档只给语言、框架和工具图标上色，图片、Markdown、JSON、压缩包等仍是灰色，
// 在应用里分辨不出类型，这里按 Pierre 色板补上同一色阶的颜色。仅未识别文件的通用图标保持灰色。
const extraHues = {
  "image-duo": palette.purple,
  "file-text-duo": palette.mint,
  "lang-markdown": palette.blue,
  braces: palette.yellow,
  "file-table-duo": palette.green,
  "file-zip-duo": palette.brown,
  "server-duo": palette.teal,
  font: palette.pink,
  stylelint: palette.indigo,
  "bash-duo": palette.green,
  nextjs: palette.indigo,
};
for (const [name, hue] of Object.entries(extraHues)) {
  const icon = icons.get(name);
  // bash-duo 在上游 Complete 档被显式设成灰色，同样视为未上色。
  if (icon && (!icon.color || icon.color.dark === palette.gray[400])) icon.color = color(hue);
}

// 文件名与扩展名映射：后出现的图标覆盖先出现的，与上游 theme-complete.json 一致。
const byName = new Map();
const byExtension = new Map();
for (const icon of [...minimal, ...defaults, ...complete]) {
  for (const name of icon.fileNames ?? []) byName.set(name.toLowerCase(), icon.name);
  for (const ext of icon.fileExtensions ?? []) byExtension.set(ext.toLowerCase(), icon.name);
}

// 上游亮色取 600 色阶，黄、橙在白底上发橄榄色，叠上图标自带的低透明度底色后显得脏灰。
// 亮色这里保持色相，把饱和度拉到 90% 以上、亮度压到 48%–55%，让它和暗色那套一样鲜亮。
function vivid(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let l = (max + min) / 2;
  if (d < 0.05) return hex;
  let s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  s = Math.max(s, 0.9);
  l = Math.min(Math.max(l, 0.48), 0.55);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r1, g1, b1] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(h / 60) % 6];
  return `#${[r1, g1, b1].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, "0")).join("")}`;
}

// 图标自带的 20%–40% 透明度底色（JS、TS 等的圆角方块）叠在深色背景上会混成暗褐、暗橄榄色，
// 暗色这里把这类淡底再调低，保留前景字形的亮度；Python 等 80% 的双色图标不受影响。
const darkTileScale = Number(process.env.PIERRE_DARK_TILE_SCALE ?? 0.4);
function softenTile(svg) {
  return svg.replace(/<path[^>]*class="bg"[^>]*>/g, (tag) =>
    tag.replace(/opacity="([\d.]+)"/, (match, value) =>
      Number(value) <= 0.4 ? `opacity="${Number((Number(value) * darkTileScale).toFixed(3))}"` : match,
    ),
  );
}

function stamp(source, icon, scheme) {
  const color = icon.color;
  const tone = (value) => (scheme === "light" ? vivid(value) : value);
  let svg;
  if (color?.fg) {
    svg = source.replaceAll("currentColor", tone(color.fg[scheme])).replace(">", `><style>.bg{fill:${tone(color.bg[scheme])}}</style>`);
  } else {
    svg = source.replaceAll("currentColor", color ? tone(color[scheme]) : fill[scheme]);
  }
  if (scheme === "dark") svg = softenTile(svg);
  return icon.opacity && icon.opacity !== 1 ? svg.replace("<svg", `<svg opacity="${icon.opacity}"`) : svg;
}

await rm(assetDir, { recursive: true, force: true });
await mkdir(assetDir, { recursive: true });
for (const icon of icons.values()) {
  const source = await readFile(path.join(upstream, "svgs", `${icon.svgName ?? icon.name}.svg`), "utf8");
  await writeFile(path.join(assetDir, `${icon.name}.svg`), stamp(source, icon, "dark"));
  await writeFile(path.join(assetDir, `${icon.name}-light.svg`), stamp(source, icon, "light"));
}
await copyFile(path.join(upstream, "LICENSE.md"), path.join(assetDir, "LICENSE"));
await writeFile(
  path.join(assetDir, "README.md"),
  `# Pierre 文件图标

这些 SVG 来自 [pierrecomputer/vscode-icons](https://github.com/pierrecomputer/vscode-icons)（npm 包 \`@pierre/vscode-icons\` ${version}）的 Complete 档，按 MIT 许可证使用；完整许可证见同目录 \`LICENSE\`。

- 配色：Pierre 色板，暗色取 400；亮色取 600 后由脚本提亮饱和度（见 \`vivid\`），避免白底上发脏。暗色把 20%–40% 透明度的淡底再调低到约 40%（见 \`softenTile\`），避免混成暗褐。语言、框架和工具图标沿用上游 \`theme-complete\`；上游仍为灰色的图片、Markdown、JSON、表格、压缩包、数据库、字体、stylelint、Shell、Next.js 由脚本补色（见 \`extraHues\`），仅未识别文件的通用图标保持灰色。
- 每个图标有 \`<name>.svg\`（暗色）和 \`<name>-light.svg\`（亮色）两份，由上游源 SVG 把 \`currentColor\` 替换成色值生成，路径未作修改，随应用离线打包。
- 文件名与扩展名映射在 \`components/pierre-file-icons.ts\`，同样由脚本生成。

更新：用 \`npm pack @pierre/vscode-icons@<版本>\` 解开后运行 \`node scripts/sync-pierre-icons.mjs <解压目录>\`，再核对本文件中的版本号。
`,
);

const names = [...icons.keys()].sort();
const ident = (name, scheme) =>
  `pierre${name.replace(/(^|[^a-zA-Z0-9]+)([a-zA-Z0-9])/g, (_, __, c) => c.toUpperCase())}${scheme === "light" ? "Light" : ""}`;
const entries = (map) =>
  [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, name]) => `  ${JSON.stringify(key)}: ${JSON.stringify(name)},`)
    .join("\n");
const imports = names
  .flatMap((name) => ["dark", "light"].map((scheme) => `import ${ident(name, scheme)} from "../assets/pierre-icons/${name}${scheme === "light" ? "-light" : ""}.svg";`))
  .join("\n");
const table = (scheme) => names.map((name) => `  ${JSON.stringify(name)}: ${ident(name, scheme)},`).join("\n");

await writeFile(
  mappingFile,
  `// 由 scripts/sync-pierre-icons.mjs 生成，来源 @pierre/vscode-icons ${version}（MIT），请勿手改。
${imports}

export const pierreIconsDark: Record<string, string> = {
${table("dark")}
};

export const pierreIconsLight: Record<string, string> = {
${table("light")}
};

export const pierreIconNameByFileName: Record<string, string> = {
${entries(byName)}
};

export const pierreIconNameByExtension: Record<string, string> = {
${entries(byExtension)}
};

export const pierreFallbackIcon = "file-duo";
`,
);
console.log(`Wrote ${names.length * 2} SVGs and ${path.relative(root, mappingFile)} (@pierre/vscode-icons ${version})`);
