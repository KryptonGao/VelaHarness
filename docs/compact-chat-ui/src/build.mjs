// 把 styles.css 的真实片段 + shell.html + app.js 拼成单文件 docs/compact-chat-ui/compact-chat-ui.html。
// 用法:node docs/compact-chat-ui/src/build.mjs(styles.css 或 styles/ 下的文件变动后重新生成)。
// 片段以选择器/注释为锚点定位,不依赖行号;锚点找不到时直接报错。
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = fileURLToPath(new URL("../../../", import.meta.url));
const scratch = here;
// styles.css 只是 @import 入口,真实规则在 styles/ 下;就地展开后得到与打包一致的完整样式。
const readStyles = (file) =>
  readFileSync(file, "utf8").replace(/^@import "([^"]+)";[ \t]*\n?/gm, (_, rel) => readStyles(resolve(dirname(file), rel)));
const css = readStyles(`${root}/apps/desktop/src/renderer/styles.css`).split("\n");

const find = (pred, from = 0) => {
  for (let i = from; i < css.length; i += 1) if (pred(css[i], i)) return i;
  throw new Error("anchor not found");
};
/** 取 [start, end) 行(0 基),以锚点文本定位,避免依赖行号。 */
const slice = (label, start, end) => {
  // 片段必须括号平衡;末行没收尾时继续往下取,直到闭合
  let stop = end;
  const depth = () => css.slice(start, stop).join("\n").replace(/\/\*[\s\S]*?\*\//g, "").split("").reduce((d, c) => d + (c === "{") - (c === "}"), 0);
  while (depth() > 0 && stop < css.length) stop += 1;
  return { label, text: css.slice(start, stop).join("\n") };
};

const parts = [];
const add = (label, start, end) => parts.push(slice(label, start, end));

// 1. 设计令牌:半径 / 字体 / 动效 + 浅色(晴空 Daylight)基底 + 派生色。深色基底与其余主题不提取。
const tokensEnd = find((l) => l.includes("主题:data-scheme")) - 1;
add("tokens:root", 0, tokensEnd);
const resetStart = find((l) => l === "*,");
const lightStart = find((l) => l.includes("晴空 Daylight(浅色基底)"));
const darkStart = find((l) => l.includes("夜航 Midnight(深色基底)"));
const derivedStart = find((l) => l.startsWith("/* 由基础色推导的色调"));
const darkDerived = find((l) => l === '[data-scheme="dark"] {', derivedStart);
add("theme:daylight", lightStart, darkStart);
add("theme:derived", derivedStart, darkDerived);

// 2. 重置 + 焦点环(去掉 html/body/#root 的 overflow 与 user-select,演示页自己处理)
const isStart = find((l) => l.startsWith(":is("), resetStart);
let reset = css.slice(resetStart, isStart).join("\n");
reset = reset.replace(/html,\s*body,\s*#root\s*\{[^}]*\}/, "");
parts.push({ label: "reset", text: reset });

// 3. 滚动条
const sb = find((l) => l === "::-webkit-scrollbar {");
add("scrollbar", sb, sb + 8);

// 4. 对话主容器与顶栏
const mcv = find((l) => l === ".main-chat-view {");
add("main-chat-view", mcv, mcv + 12);
const hdr = find((l) => l === ".main-chat-header {");
add("main-chat-header", hdr, hdr + 13);
const tgrp = find((l) => l === ".chat-title-group {");
add("chat-title-group", tgrp, tgrp + 6);
const cat = find((l) => l === ".chat-active-title {");
add("chat-active-title", cat, cat + 9);
const rename = find((l) => l === ".chat-title-rename {");
add("chat-title-rename", rename, rename + 12);

// 5. 对话流主体:滚动区 → 用户消息 → Markdown → 回复 → 思考 → 工具卡片(卡片模式)
const chatStart = find((l) => l.includes("动画作用在可继承的颜色上"));
const compactStart = find((l) => l.includes("紧凑模式把工具作为过程文本阅读"));
add("chat-flow", chatStart, compactStart);

// 6. 紧凑模式 + 执行清单 + 子代理(到 Agent Pane 之前)
const agentPane = find((l) => l.includes("右侧 Agent Pane"));
add("compact+plan+agent", compactStart, agentPane);

// 7. 终端 / 代码表 / diff 行 / 状态动画
const term = find((l) => l === ".tool-terminal {");
const dock = find((l) => l === ".chat-dock-wrapper {");
add("terminal+sheet+keyframes", term, dock);

// 8. 输入框:dock、浮层卡片、统计行、textarea、控件行、发送/停止
const entry = find((l) => l === ".composer-entry {");
const dockEnd = find((l) => l === ".input-textarea {");
add("composer-dock", dock, dockEnd);
add("composer-textarea", dockEnd, entry);
const dcr = find((l) => l === ".dock-controls-row,");
const sidebarRight = find((l) => l === ".sidebar-right-header {");
add("composer-controls", dcr, sidebarRight);
const attach = find((l) => l === ".attach-btn {");
add("attach-btn", attach, attach + 10);
const mode = find((l) => l === ".mode-pill {");
add("mode-pill", mode, mode + 14);

// 9. 工具卡片顶部小按钮 / 文件引用 / 本轮文件统计卡
const cardTop = find((l) => l.includes("工具卡片上的预览按钮"));
const diffPreview = find((l) => l.includes("diff 面板里的侧栏预览入口"));
add("tool-card-top", cardTop, diffPreview);
const fileRef = find((l) => l.includes("回复正文的内联文件引用"));
const motionSec = find((l) => l.includes("界面动效 ----------"));
add("file-ref+turn-changes", fileRef, motionSec);

// 10. 动效:入场、reduce-motion、跳到最新、对话车道、markdown 块、content-swap、状态位
const msgEnter = find((l) => l === ".message-enter {");
const agentTrace = find((l) => l.includes("Agent trace: compact observability"));
add("message-enter+reduced-motion", msgEnter, agentTrace);
const pane = find((l) => l === ".chat-conversation-pane {");
const tabs = find((l) => l === ".conversation-view-tabs {" || l.startsWith(".conversation-view-tabs {"));
add("conversation-pane+jump-latest", pane, tabs);
const mdBlock = find((l) => l === ".md-block { display: contents; }");
add("md-block", mdBlock, mdBlock + 6);
const summaryArrival = find((l) => l.startsWith(".summary-arrival {"));
add("summary-arrival", summaryArrival, summaryArrival + 2);
const surface = find((l) => l === ".chat-message-surface {");
const motionList = find((l) => l === ".motion-list { position: relative; }");
add("message-surface+content-swap", surface, motionList);
const inputT = find((l) => l.startsWith(".input-textarea { transition: height"));
const slotEnd = find((l) => l.startsWith(".composer-action-slot.is-streaming.has-instruction"), inputT) + 1;
add("composer-action-slot", inputT, slotEnd);
const swap = find((l) => l.startsWith(".tool-status-swap {"));
const diffContent = find((l) => l.startsWith(".diff-content-enter"));
add("tool-status-swap+tool-card-in", swap, diffContent);

const extracted = parts.map((p) => `/* ═══ ${p.label} ═══ */\n${p.text}`).join("\n\n");

const shell = readFileSync(`${scratch}/shell.html`, "utf8");
const js = readFileSync(`${scratch}/app.js`, "utf8");
const out = shell.replace("/*@@VELA_CSS@@*/", () => extracted).replace("/*@@APP_JS@@*/", () => js.replace(/<\/script>/g, "<\\/script>"));
const dest = `${root}/docs/compact-chat-ui/compact-chat-ui.html`;
writeFileSync(dest, out);
console.log("wrote", dest, (out.length / 1024).toFixed(0) + " KB");
for (const p of parts) console.log(String(p.text.split("\n").length).padStart(5), p.label);
