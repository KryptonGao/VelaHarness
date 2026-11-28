#!/usr/bin/env node
// 从 Iconify 的 MingCute 图标集生成应用内置的界面图标。
//
// 用法：node scripts/sync-mingcute-icons.mjs
//
// 应用里只用这里列出的语义名（左）调用图标，MingCute 的原名（右）只出现在本文件，
// 以后换图标库只需要改这张表。每个图标输出 `<name>.svg`（线性）和 `<name>-fill.svg`（实心，
// 上游没有时省略），并生成 `registry.generated.ts` 把它们内联成字符串，由 <Icon> 渲染。
// 新增图标：在下表加一行，运行脚本，把生成的文件一并提交。
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ICONS = {
  "chevron-right": "right",
  "chevron-left": "left",
  "chevron-up": "up",
  "chevron-down": "down",
  plus: "add",
  minus: "minimize",
  close: "close",
  check: "check",
  "check-circle": "check-circle",
  search: "search",
  copy: "copy-2",
  trash: "delete-2",
  settings: "settings-3",
  sidebar: "layout-left",
  "sidebar-expanded": "sidebar-left",
  "sidebar-collapsed": "sidebar-left-collapse",
  clock: "time",
  inbox: "inbox",
  star: "star",
  bell: "notification",
  globe: "earth",
  chat: "message-1",
  folder: "folder",
  file: "file",
  terminal: "terminal-box",
  "terminal-output": "square",
  branch: "git-branch",
  "pull-request": "git-pull-request",
  edit: "edit-2",
  "edit-file": "edit-2",
  compose: "edit",
  clipboard: "clipboard",
  sliders: "settings-6",
  archive: "archive",
  "folder-open": "folder-open",
  more: "more-1",
  undo: "back-2",
  "file-diff": "file-diff",
  list: "list-check",
  cards: "layout-5",
  "panel-right": "layout-right",
  "panel-columns": "layout-3",
  annotate: "comment",
  "arrow-left": "arrow-left",
  "arrow-right": "arrow-right",
  "arrow-up": "arrow-up",
  "arrow-down": "arrow-down",
  monitor: "monitor",
  subagent: "folder-tree",
  bot: "robot",
  shield: "safe-shield",
  eye: "eye",
  "eye-off": "eye-close",
  cube: "cube",
  external: "external-link",
  github: "github",
  grid: "dot-grid",
  pause: "pause",
  play: "play",
  speaker: "volume",
  "stop-square": "square",
  mic: "mic",
  send: "send-plane",
  circle: "round",
  image: "pic",
  mcp: "plugin",
  tool: "tool",
  "todo-list": "list-todo",
  outcome: "flag-1",
  acceptance: "file-check",
  followup: "corner-down-right",
  "schedule-create": "calendar-add",
  "schedule-list": "calendar",
  "schedule-update": "calendar-sync",
  "schedule-delete": "calendar-x",
  "memory-read": "book",
  "memory-update": "book-plus",
  "web-search": "search-2",
  "web-fetch": "download-2",
  "read-file": "file-search",
  "file-plus": "file-new",
  stack: "layers",
  plan: "map",
  goal: "target",
  race: "flag-4",
  skill: "magic-1",
  "skill-read": "bookmark",
  prompt: "terminal",
  question: "question",
  sparkles: "sparkles-2",
  thinking: "bulb",
  refresh: "refresh-1",
  cloud: "cloud",
  alert: "alert",
  commit: "git-commit",
  tag: "tag",
  visual: "layout-grid",
  expand: "fullscreen-2",
  code: "code",
  lightning: "lightning",
  gauge: "dashboard",
  home: "home-3",
  history: "history-anticlockwise",
  diff: "diff",
  "zoom-in": "zoom-in",
  "zoom-out": "zoom-out",
  warning: "warning",
  "close-circle": "close-circle",
  "minus-circle": "minus-circle",
  pin: "pin",
  key: "key-2",
  heartbeat: "heartbeat",
  "git-merge": "git-merge",
  filter: "filter-2",
  brain: "brain",
  ruler: "ruler",
  maximize: "fullscreen",
  minimize: "fullscreen-exit",
  grip: "dots",
  sun: "sun",
  keyboard: "keyboard",
  info: "information",
  chip: "chip",
  server: "server",
  hook: "webhook",
  "chart-bar": "chart-bar",
  document: "document",
  "align-left": "align-left",
  user: "user-3",
  "corner-down-left": "corner-down-left",
  compass: "compass",
  bug: "bug",
  flask: "flask",
  book: "book",
  "file-search": "file-search",
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "apps/desktop/src/renderer/components/icons");
const svgDir = path.join(dir, "svg");

async function getJson(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return await res.json();
    } catch (error) {
      if (attempt >= 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
}

const wanted = Object.values(ICONS).flatMap((base) => [`${base}-line`, `${base}-fill`]);
const data = await getJson(`https://api.iconify.design/mingcute.json?icons=${wanted.join(",")}`);

const resolve = (name) => data.icons?.[name] ?? data.icons?.[data.aliases?.[name]?.parent];
const wrap = (icon) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${icon.width ?? data.width ?? 24} ${icon.height ?? data.height ?? 24}">${icon.body}</svg>\n`;

await mkdir(svgDir, { recursive: true });
for (const file of await readdir(svgDir)) if (file.endsWith(".svg")) await rm(path.join(svgDir, file));

const registry = {};
const missing = [];
for (const [name, base] of Object.entries(ICONS)) {
  let line = resolve(`${base}-line`);
  if (!line) { missing.push(`${base}-line`); continue; }
  let fill = resolve(`${base}-fill`);
  if (name === "terminal-output") {
    // Use the MingCute terminal-sized square for both variants. Cut the same three rows out of the solid interior.
    const frame = line.body;
    const rows = "M7 7h2v2H7z M11 7h6v2h-6z M7 11h10v2H7z M7 15h6v2H7z M15 15h2v2h-2z";
    line = { ...line, body: `${frame}<path fill="currentColor" d="${rows}"/>` };
    if (fill) fill = { ...fill, body: `${frame}<path fill="currentColor" fill-rule="evenodd" d="M4.5 4.5h15v15h-15z ${rows}"/>` };
  }
  await writeFile(path.join(svgDir, `${name}.svg`), wrap(line));
  registry[name] = { line: line.body };
  if (fill) {
    await writeFile(path.join(svgDir, `${name}-fill.svg`), wrap(fill));
    registry[name].fill = fill.body;
  }
}
if (missing.length) { console.error(`Missing upstream icons: ${missing.join(", ")}`); process.exit(1); }

const names = Object.keys(registry);
const out = [
  `// 由 scripts/sync-mingcute-icons.mjs 生成，来源 MingCute（经 Iconify 的 mingcute 图标集获取，Apache-2.0，见 LICENSE），请勿手改。`,
  `export type IconName = ${names.map((n) => JSON.stringify(n)).join(" | ")};`,
  "",
  "export interface IconEntry { line: string; fill?: string }",
  "",
  "export const iconRegistry: Record<IconName, IconEntry> = {",
  ...names.map((n) => `  ${JSON.stringify(n)}: ${JSON.stringify(registry[n])},`),
  "};",
  "",
].join("\n");
await writeFile(path.join(dir, "registry.generated.ts"), out);
console.log(`MingCute: ${names.length} icons, ${names.filter((n) => registry[n].fill).length} with fill`);
