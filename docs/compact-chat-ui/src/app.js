/* Vela 紧凑对话流参考实现 —— 原生 JS,无依赖。
 * 与 apps/desktop/src/renderer 的 React 组件一一对应,函数名沿用原名,方便移植:
 *   ToolList / CompactToolGroup / CompactToolLine / AgentToolCard / GenericToolCard
 *   Thinking / CompletedAssistantTurn / TurnChangesCard / ReplyActions
 *   groupProcessItems / compactSummaryParts / parseDisplayDiff / collapseDiffContext
 */
(() => {
  "use strict";

  /* ───────────────────────── i18n(只覆盖紧凑对话流用到的文案) ───────────────────────── */
  let lang = "zh";
  const tr = (zh, en) => (lang === "zh" ? zh : en);
  const trf = (zh, en, ...args) => (lang === "zh" ? zh : en).replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)]));

  /* ───────────────────────── DOM 小工具 ───────────────────────── */
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value == null || value === false) continue;
      if (key === "class") el.className = value;
      else if (key === "html") el.innerHTML = value;
      else if (key.startsWith("on")) el.addEventListener(key.slice(2).toLowerCase(), value);
      else if (value === true) el.setAttribute(key, "");
      else el.setAttribute(key, value);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }
  /** replaceChildren 会把 null 当成字符串,这里先清掉。 */
  const fill = (el, ...kids) => { el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false)); };
  const html = (markup) => {
    const t = document.createElement("template");
    t.innerHTML = markup.trim();
    return t.content.firstChild;
  };
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  /* ───────────────────────── 图标(与 components/icons.tsx 同一套路径) ───────────────────────── */
  const icon = (size, inner, cls = "") =>
    `<svg ${cls ? `class="${cls}" ` : ""}width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  const ICON = {
    terminal: (s = 13) => icon(s, '<rect x="3" y="4" width="18" height="16" rx="2"/><polyline points="7 9 10 12 7 15"/><line x1="12" y1="15" x2="17" y2="15"/>'),
    eye: (s = 13) => icon(s, '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
    pencil: (s = 13) => icon(s, '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
    filePlus: (s = 13) => icon(s, '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>'),
    thinking: (s = 13) => icon(s, '<path d="M9 18h6M10 21.5h4"/><path d="M12 2.5a6.5 6.5 0 0 0-3.7 11.85c.45.32.7.8.7 1.35V16h6v-.3c0-.55.25-1.03.7-1.35A6.5 6.5 0 0 0 12 2.5Z"/>'),
    stack: (s = 13) => icon(s, '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 12 12 17 22 12"/><polyline points="2 17 12 22 22 17"/>'),
    subagent: (s = 13) => icon(s, '<rect x="8.5" y="3" width="7" height="7" rx="1.8"/><rect x="3" y="14" width="7" height="7" rx="1.8"/><rect x="14" y="14" width="7" height="7" rx="1.8"/><path d="M12 10v2"/><path d="M6.5 14v-2h11v2"/>'),
    tool: (s = 13) => icon(s, '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z"/>'),
    copy: (s = 13) => icon(s, '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
    check: (s = 13) => icon(s, '<polyline points="20 6 9 17 4 12"/>'),
    branch: (s = 13) => icon(s, '<line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>'),
    history: (s = 13) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 2.64-6.36L3 8.3"/><path d="M3 3.5v4.8h4.8"/><path d="M12 7.5V12l3 2"/></svg>`,
    arrowDown: (s = 11) => icon(s, '<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>'),
    send: (s = 15) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 2L11 13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`,
    plus: (s = 14) => icon(s, '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),
    circle: (s = 11) => icon(s, '<circle cx="12" cy="12" r="9"/>'),
    arrowRight: (s = 11) => icon(s, '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>'),
    x: (s = 11) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    chevronDown: (s = 13, cls = "") => icon(s, '<path d="m6 9 6 6 6-6"/>', cls),
    pencilTitle: (s = 13) => icon(s, '<path d="m16 3 5 5-12 12-6 1 1-6L16 3Z"/><path d="m14 5 5 5"/>'),
    fileChange: () => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="2.5" width="18" height="19" rx="3"/><path d="M8 8h8M8 16h8M12 5v6"/></svg>`,
    undo: () => `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-2"/></svg>`,
    panel: () => `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="16" y1="3" x2="16" y2="21"/></svg>`,
  };
  /** 展开箭头:12px、2.5 描边,朝右,展开后 CSS 转 90°。 */
  const chevron = (cls) => icon(12, '<polyline points="9 18 15 12 9 6"/>', cls).replace('stroke-width="2"', 'stroke-width="2.5"');
  const iconEl = (markup) => html(markup);

  /** 点阵加载动画:6×6,沿对角线的相位差,周期 2s。真实实现是 canvas 回放 dot-motion-loader.json。 */
  function ActivityIndicator(label) {
    const el = h("span", { class: "tool-activity-loader dot-loader", role: "status", "aria-label": label || tr("运行中", "Running") });
    for (let r = 0; r < 6; r += 1) {
      for (let c = 0; c < 6; c += 1) {
        const shift = ((r + c) * 0.14) % 1;
        el.append(h("i", { style: `--d:${((shift - 1) * 2).toFixed(3)}s` }));
      }
    }
    return el;
  }

  /* ───────────────────────── 纯函数:与 tool-compact.ts / tool-sequence.ts / ToolCard.tsx 对应 ───────────────────────── */
  const FOLDABLE = new Set(["bash", "read", "edit", "write"]);
  const toolKind = (name) => (name === "browser_repl" || name === "browser_repl_reset" ? "browser" : FOLDABLE.has(name) ? name : "other");
  const compactKind = (name) => (FOLDABLE.has(name) ? name : null);
  const shouldFoldRun = (length, display) => (display === "compact" ? length > 1 : length >= 3);
  const isAgentTool = (name) => name === "task";

  function splitPath(path) {
    const n = path.replaceAll("\\", "/");
    const i = n.lastIndexOf("/");
    if (i <= 0) return { name: path, dir: "" };
    return { name: n.slice(i + 1), dir: n.slice(0, i) };
  }

  function diffStat(diff) {
    if (!diff) return null;
    let added = 0;
    let removed = 0;
    for (const line of diff.split("\n")) {
      if (line.startsWith("+") && !line.startsWith("+++")) added += 1;
      else if (line.startsWith("-") && !line.startsWith("---")) removed += 1;
    }
    return added || removed ? { added, removed } : null;
  }
  function totalDiffStat(tools) {
    let added = 0;
    let removed = 0;
    for (const tool of tools) {
      const s = diffStat(tool.activity && tool.activity.diff);
      if (s) { added += s.added; removed += s.removed; }
    }
    return added || removed ? { added, removed } : null;
  }

  /** 按首次出现顺序聚合种类;同一文件的同类操作只计一次(bash 每条都计)。 */
  function compactSummaryParts(tools) {
    const order = [];
    const counts = new Map();
    const seen = new Set();
    for (const tool of tools) {
      const kind = compactKind(tool.name);
      if (!kind) continue;
      if (kind !== "bash") {
        const path = tool.activity && tool.activity.path ? tool.activity.path.trim().replaceAll("\\", "/") : "";
        if (path) {
          const key = `${kind}:${path}`;
          if (seen.has(key)) continue;
          seen.add(key);
        }
      }
      if (!counts.has(kind)) order.push(kind);
      counts.set(kind, (counts.get(kind) || 0) + 1);
    }
    return order.map((kind) => ({ kind, count: counts.get(kind) || 0 }));
  }

  /** 展示 diff 的一行形如 `+ 12 text`;`...` 是省略的上下文。 */
  function parseDisplayDiff(diff) {
    const rows = [];
    const re = /^([+\- ]) *(\d+) (.*)$/;
    const lines = diff.split("\n");
    if (lines[lines.length - 1] === "") lines.pop();
    for (const line of lines) {
      if (line.trim() === "..." || line.trim() === "…") { rows.push({ kind: "gap", gutter: "", text: "…" }); continue; }
      const m = re.exec(line);
      if (m) rows.push({ kind: m[1] === "+" ? "add" : m[1] === "-" ? "del" : "ctx", gutter: m[2], text: m[3] || "" });
      else if (line.startsWith("+")) rows.push({ kind: "add", gutter: "", text: line.slice(1) });
      else if (line.startsWith("-")) rows.push({ kind: "del", gutter: "", text: line.slice(1) });
      else rows.push({ kind: "ctx", gutter: "", text: line.trim() ? line.slice(1) : "" });
    }
    return rows;
  }

  /** 紧凑 diff:两处改动之间超过 3 行的未改内容只留首尾各一行,中间换成 7px 细分隔带。 */
  function collapseDiffContext(rows) {
    const out = [];
    const changedAfter = new Array(rows.length + 1).fill(false);
    for (let i = rows.length - 1; i >= 0; i -= 1) changedAfter[i] = changedAfter[i + 1] || rows[i].kind === "add" || rows[i].kind === "del";
    let i = 0;
    let changeBefore = false;
    while (i < rows.length) {
      const row = rows[i];
      if (row.kind !== "ctx") {
        out.push(row);
        if (row.kind === "add" || row.kind === "del") changeBefore = true;
        i += 1;
        continue;
      }
      const start = i;
      while (i < rows.length && rows[i].kind === "ctx") i += 1;
      const ctx = rows.slice(start, i);
      if (ctx.length > 3 && changeBefore && changedAfter[i]) out.push(ctx[0], { kind: "gap", gutter: "", text: "" }, ctx[ctx.length - 1]);
      else out.push(...ctx);
    }
    return out;
  }

  function subjectOf(kind, activity, name) {
    if (kind === "bash") {
      const command = (activity.command || "").replace(/\s+/g, " ").trim();
      return { name: command || tr("命令", "Command"), dir: "" };
    }
    const path = (activity.path || "").trim();
    if (!path) {
      if (name === "update_plan" && activity.plan && activity.plan.length) return { name: activity.plan[0].text, dir: "" };
      return { name, dir: "" };
    }
    const n = path.replaceAll("\\", "/");
    if (n.lastIndexOf("/") <= 0) return { name: path, dir: "" };
    return splitPath(path);
  }

  const compactAction = (kind) => (kind === "write" ? tr("已创建", "Created") : kind === "edit" ? tr("已编辑", "Edited") : kind === "read" ? tr("已读取", "Read") : tr("已运行", "Ran"));
  function compactPartLabel({ kind, count }) {
    if (kind === "edit") return trf("已编辑 {0} 个文件", count === 1 ? "Edited {0} file" : "Edited {0} files", count);
    if (kind === "write") return trf("已创建 {0} 个文件", count === 1 ? "Created {0} file" : "Created {0} files", count);
    if (kind === "read") return trf("已读取 {0} 个文件", count === 1 ? "Read {0} file" : "Read {0} files", count);
    return trf("已运行 {0} 条命令", count === 1 ? "Ran {0} command" : "Ran {0} commands", count);
  }
  const toolLabel = (name, kind) => {
    if (name === "update_plan") return tr("执行清单", "Execution");
    if (name === "submit_plan") return tr("计划", "Plan");
    return { bash: "Bash", read: "Read", edit: "Edit", write: "Write", browser: "Browser REPL", other: tr("工具", "Tool") }[kind];
  };

  function formatDuration(ms) {
    const d = Math.max(0, ms);
    if (d < 1000) return `${Math.floor(d)}ms`;
    if (d < 60000) return `${(Math.min(599, Math.round(d / 100)) / 10).toFixed(1)}s`;
    const s = Math.floor(d / 1000);
    return `${Math.floor(s / 60)}m${s % 60}s`;
  }
  function formatElapsed(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    if (total < 1) return tr("不到 1 秒", "<1 sec");
    const hh = Math.floor(total / 3600);
    const mm = Math.floor((total % 3600) / 60);
    const ss = total % 60;
    if (hh > 0) return trf("{0}小时{1}分{2}秒", "{0}h {1}m {2}s", hh, mm, ss);
    if (mm > 0) return trf("{0}分{1}秒", "{0}m {1}s", mm, ss);
    return trf("{0}秒", "{0}s", ss);
  }
  const toolsDuration = (tools) => {
    let total = 0;
    for (const t of tools) { if (t.status === "running" || typeof t.durationMs !== "number") return null; total += t.durationMs; }
    return tools.length ? total : null;
  };

  /** 按连续的可折叠工具切段;非折叠类工具自成一段。 */
  function splitToolRuns(tools) {
    const segments = [];
    let run = [];
    for (const tool of tools) {
      if (toolKind(tool.name) === "other") {
        if (run.length) segments.push(run);
        run = [];
        segments.push([tool]);
      } else run.push(tool);
    }
    if (run.length) segments.push(run);
    return segments;
  }

  /** toolFold = "position":整轮拍平后按位置合并相邻工具,思考/正文/交互卡片都会打断。 */
  function buildTurnItems(messages, includeText) {
    const items = [];
    for (const m of messages) {
      if (m.thinking) items.push({ kind: "thinking", id: m.id, messageId: m.id, text: m.thinking });
      for (const tool of m.tools) items.push({ kind: "tool", id: tool.id, messageId: m.id, tool });
      if (m.text && (!includeText || includeText(m))) items.push({ kind: "text", id: `${m.id}:text`, messageId: m.id, text: m.text });
    }
    return items;
  }
  function groupProcessItems(items, display) {
    const nodes = [];
    let run = [];
    const flush = () => {
      if (!run.length) return;
      const tools = run.map((i) => i.tool);
      if (shouldFoldRun(tools.length, display)) nodes.push({ type: "run", id: run[0].id, messageId: run[0].messageId, tools });
      else for (const i of run) nodes.push({ type: "tool", id: i.id, messageId: i.messageId, tool: i.tool });
      run = [];
    };
    for (const item of items) {
      if (item.kind === "tool" && FOLDABLE.has(item.tool.name)) { run.push(item); continue; }
      flush();
      if (item.kind === "tool") nodes.push({ type: "tool", id: item.id, messageId: item.messageId, tool: item.tool });
      else nodes.push({ type: item.kind, id: item.id, messageId: item.messageId, text: item.text });
    }
    flush();
    return nodes;
  }

  /* ───────────────────────── 状态:折叠记忆 / 偏好 ───────────────────────── */
  const prefs = { toolFold: "message", details: false, iconColor: true };
  /** 折叠状态,键与 tool-fold-state.ts 一致:rows:<toolId> / sequences:<id>。 */
  const fold = new Map();
  const foldRow = (id) => `rows:${id}`;
  const foldSeq = (id) => `sequences:${id}`;
  const isOpen = (id, fallback = false) => (fold.has(id) ? fold.get(id) : fallback);
  let seen = new Set(); // 已经出现过的节点,重绘时不再重放入场动画

  /* ───────────────────────── Markdown(演示用的极简实现) ───────────────────────── */
  function inline(text) {
    let s = esc(text);
    s = s.replace(/`([^`]+)`/g, (_, c) => (/\.(ts|tsx|js|json|md|css)$|\//.test(c) ? `<code class="code-file-ref">${c}</code>` : `<code>${c}</code>`));
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    return s;
  }
  function markdown(text, opts = {}) {
    const root = h("div", { class: "md-content" });
    const blocks = [];
    const lines = text.replace(/\r/g, "").split("\n");
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i += 1; continue; }
      if (line.startsWith("```")) {
        const body = [];
        i += 1;
        while (i < lines.length && !lines[i].startsWith("```")) { body.push(lines[i]); i += 1; }
        i += 1;
        blocks.push(`<pre><code>${highlight(body.join("\n"))}</code></pre>`);
      } else if (/^#{1,6} /.test(line)) {
        const level = line.match(/^#+/)[0].length;
        blocks.push(`<h${level}>${inline(line.replace(/^#+ /, ""))}</h${level}>`);
        i += 1;
      } else if (/^\s*[-*] /.test(line) || /^\s*\d+\. /.test(line)) {
        const ordered = /^\s*\d+\. /.test(line);
        const items = [];
        while (i < lines.length && (ordered ? /^\s*\d+\. /.test(lines[i]) : /^\s*[-*] /.test(lines[i]))) {
          items.push(`<li>${inline(lines[i].replace(/^\s*(?:[-*]|\d+\.) /, ""))}</li>`);
          i += 1;
        }
        blocks.push(`<${ordered ? "ol" : "ul"}>${items.join("")}</${ordered ? "ol" : "ul"}>`);
      } else if (line.startsWith("|")) {
        const rows = [];
        while (i < lines.length && lines[i].startsWith("|")) { rows.push(lines[i]); i += 1; }
        const cells = (r) => r.split("|").slice(1, -1).map((c) => c.trim());
        const head = cells(rows[0]);
        const body = rows.slice(2).map(cells);
        blocks.push(`<div class="md-table-scroll"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      } else {
        const para = [];
        while (i < lines.length && lines[i].trim() && !/^(```|#{1,6} |\s*[-*] |\s*\d+\. |\|)/.test(lines[i])) { para.push(lines[i]); i += 1; }
        blocks.push(`<p>${inline(para.join(" "))}</p>`);
      }
    }
    const block = h("div", { class: `md-block${opts.entering ? " is-entering" : ""}`, html: blocks.join("") });
    root.append(block);
    return root;
  }

  /** 极简 TS 高亮:颜色取 --syntax-*,对应真实应用里 shiki 分词后写进 style 的 color。 */
  function highlight(code) {
    const re = /(\/\/.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|\b(const|let|var|export|function|return|await|async|import|from|if|else|throw|new|type|interface|extends|for|of|while|catch|try|default|as)\b|\b(\d+(?:\.\d+)?)\b|\b([A-Z][A-Za-z0-9]*)\b|\b([a-zA-Z_$][\w$]*)(?=\()/gm;
    let out = "";
    let last = 0;
    for (let m = re.exec(code); m; m = re.exec(code)) {
      out += esc(code.slice(last, m.index));
      const cls = m[1] ? "comment" : m[2] ? "string" : m[3] ? "keyword" : m[4] ? "number" : m[5] ? "type" : "function";
      out += `<span style="color:var(--syntax-${cls})">${esc(m[0])}</span>`;
      last = m.index + m[0].length;
    }
    return out + esc(code.slice(last));
  }

  /* ───────────────────────── 基础积木 ───────────────────────── */
  /** 0fr→1fr 网格折叠。子内容首次展开时才创建(LazyMount),之后保留。 */
  function ToolCollapse(open, build) {
    const inner = h("div", { class: "tool-collapse-inner" });
    const root = h("div", { class: "tool-collapse" }, inner);
    let mounted = false;
    const set = (value) => {
      if (value && !mounted) { mounted = true; inner.append(...[].concat(build())); }
      if (value) inner.removeAttribute("inert");
      else inner.setAttribute("inert", "");
    };
    set(open);
    return { el: root, set };
  }

  /** 限高滚动容器:上下边缘渐隐,强度随距边缘的距离平滑变化(thinking-edges.ts)。 */
  function thinkingEdges(scrollTop, scrollHeight, clientHeight) {
    const max = Math.max(0, scrollHeight - clientHeight);
    const pos = Math.max(0, Math.min(scrollTop, max));
    const strength = (d) => { const p = Math.min(d / 24, 1); return p * p * (3 - 2 * p); };
    return { top: strength(pos), bottom: strength(max - pos) };
  }
  function ScrollFade(className, contentClass, child, onReady) {
    const content = h("div", { class: `stream-prose-block thinking-text${contentClass ? " " + contentClass : ""}` }, child);
    const viewport = h("div", { class: "thinking-scroll-viewport", role: "region", tabindex: "0", "aria-label": tr("可在区域内滚动", "Scrollable") }, content);
    const top = h("div", { class: "thinking-scroll-fade thinking-scroll-fade-top", "aria-hidden": "true", style: "opacity:0" });
    const bottom = h("div", { class: "thinking-scroll-fade thinking-scroll-fade-bottom", "aria-hidden": "true", style: "opacity:0" });
    const shell = h("div", { class: `thinking-scroll-shell has-content-edge-blur${className ? " " + className : ""}` }, viewport, top, bottom);
    const sync = () => {
      shell.style.setProperty("--thinking-edge-height", `${Math.min(66, viewport.clientHeight / 2)}px`);
      const e = thinkingEdges(viewport.scrollTop, viewport.scrollHeight, viewport.clientHeight);
      top.style.opacity = String(e.top);
      bottom.style.opacity = String(e.bottom);
      if (onReady) onReady(viewport);
    };
    viewport.addEventListener("scroll", sync, { passive: true });
    new ResizeObserver(sync).observe(viewport);
    new ResizeObserver(sync).observe(content);
    return { el: shell, viewport, sync };
  }

  /** 紧凑行只标异常状态:运行中点阵、失败红叉,完成宽度为 0。 */
  function CompactStatus(running, failed) {
    const key = running ? "running" : failed ? "error" : "done";
    const wrap = h("span", { class: `content-swap tool-status-swap compact is-${key}` });
    if (running) wrap.append(h("span", { class: "content-swap-current" }, ActivityIndicator()));
    else if (failed) wrap.append(h("span", { class: "content-swap-current" }, h("span", { class: "tool-compact-error", role: "img", "aria-label": tr("失败", "Failed"), html: ICON.x(11) })));
    return wrap;
  }
  /** 卡片行的状态位(update_plan 等 other 类卡片):完成画对勾。 */
  function StatusMark(status) {
    const wrap = h("span", { class: `content-swap tool-status-swap is-${status}` });
    let inner;
    if (status === "running") inner = ActivityIndicator();
    else if (status === "error") inner = h("span", { class: "tool-status-mark error", role: "img", "aria-label": tr("失败", "Failed"), html: ICON.x(12) });
    else inner = h("span", { class: "tool-status-mark done", role: "img", "aria-label": tr("完成", "Complete"), html: ICON.check(12) });
    wrap.append(h("span", { class: "content-swap-current" }, inner));
    return wrap;
  }
  const DurationLabel = (ms) => h("span", { class: "tool-duration", "aria-hidden": ms == null ? "true" : null }, ms == null ? "" : `· ${formatDuration(ms)}`);
  const ToolDurationLabel = (tool) => (prefs.details ? DurationLabel(tool.status === "running" ? null : tool.durationMs) : null);

  /** 文件类型图标:真实应用用 devicon / material-icon-theme,这里用按扩展名着色的小徽标代替。 */
  const EXT_COLOR = { ts: "#3178c6", tsx: "#3178c6", js: "#f1c40f", json: "#cb9820", md: "#7a8aa0", css: "#7c5cd6", mjs: "#f1c40f" };
  function FileTypeIcon(path) {
    const ext = (path.split(".").pop() || "").toLowerCase();
    const color = EXT_COLOR[ext] || "#8b95a7";
    return h("span", { class: "file-type-icon", style: `display:inline-grid;place-items:center;border-radius:3px;background:${color};color:#fff;font:700 7px/1 var(--font-mono);letter-spacing:-.02em` }, (ext || "f").slice(0, 2).toUpperCase());
  }

  const toast = (() => {
    let el;
    let timer;
    return (text) => {
      el = el || document.body.appendChild(h("div", { class: "demo-toast", role: "status" }));
      el.textContent = text;
      el.classList.add("show");
      clearTimeout(timer);
      timer = setTimeout(() => el.classList.remove("show"), 1600);
    };
  })();
  const openPreview = (path) => toast(`${tr("在右侧预览", "Preview in sidebar")}: ${path}`);

  /* ───────────────────────── 工具展示:Bash / Diff / 子代理 / 计划 ───────────────────────── */
  function BashView({ command, output, running, failed }) {
    return h("div", { class: `tool-terminal${failed ? " failed" : ""}` },
      command ? h("div", { class: "tool-terminal-cmd" }, h("span", { class: "tool-terminal-prompt" }, "$"), h("span", null, command)) : null,
      output ? h("pre", { class: "tool-terminal-out" }, output) : h("div", { class: "tool-terminal-wait" }, running ? tr("运行中", "Running") : tr("无输出", "No output")));
  }

  function DiffView(diff, compact) {
    let rows = parseDisplayDiff(diff);
    if (compact) rows = collapseDiffContext(rows);
    const sheet = h("div", { class: `tool-sheet${compact ? " tool-sheet-compact-diff" : ""}` });
    for (const row of rows) {
      if (row.kind === "gap") { sheet.append(h("div", { class: `tool-diff-gap${compact ? " is-compact" : ""}` }, compact ? null : row.text)); continue; }
      sheet.append(h("div", { class: `tool-code-line tool-diff-line ${row.kind}` },
        h("span", { class: "tool-gutter" }, h("span", { class: "tool-sign" }, row.kind === "add" ? "+" : row.kind === "del" ? "−" : ""), row.gutter),
        h("span", { class: "tool-code-text", html: highlight(row.text) || " " })));
    }
    return sheet;
  }

  function CompactDiffCard({ fileName, diff, note }) {
    const stat = diffStat(diff);
    const copyBtn = h("button", { class: "compact-diff-card-copy", type: "button", title: tr("复制差异", "Copy diff"), "aria-label": tr("复制差异", "Copy diff"), html: ICON.copy(13) });
    copyBtn.addEventListener("click", () => {
      navigator.clipboard && navigator.clipboard.writeText(diff).catch(() => {});
      copyBtn.innerHTML = ICON.check(13);
      setTimeout(() => (copyBtn.innerHTML = ICON.copy(13)), 1400);
    });
    const fade = ScrollFade("compact-diff-scroll-shell", "compact-diff-scroll-content", DiffView(diff, true));
    fade.el.querySelector(".thinking-text").style.padding = "0";
    fade.viewport.style.maxHeight = "320px";
    return h("section", { class: "compact-diff-card", "aria-label": trf("{0} 的文件差异", "{0} file diff", fileName) },
      h("header", { class: "compact-diff-card-head" },
        h("span", { class: "compact-diff-card-name", title: fileName }, fileName),
        stat ? h("span", { class: "compact-diff-card-stat" }, stat.added ? h("span", { class: "tool-stat-add" }, `+${stat.added}`) : null, stat.removed ? h("span", { class: "tool-stat-del" }, `-${stat.removed}`) : null) : null,
        copyBtn),
      note ? h("div", { class: "tool-markdown compact-diff-card-note" }, note) : null,
      fade.el);
  }

  const StatSpan = (stat, cls) => stat ? h("span", { class: cls }, stat.added ? h("span", { class: "tool-stat-add" }, `+${stat.added}`) : null, stat.removed ? h("span", { class: "tool-stat-del" }, `−${stat.removed}`) : null) : null;

  /* ───────────────────────── CompactToolLine:单行(文件类 / bash) ───────────────────────── */
  function CompactToolLine(tool, { hideAction = false, hideIcon = false } = {}) {
    const id = foldRow(tool.id);
    const kind = toolKind(tool.name);
    const activity = tool.activity || {};
    const subject = subjectOf(kind, activity, tool.name);
    const stat = diffStat(activity.diff);
    const running = tool.status === "running";
    const failed = tool.status === "error";
    let open = isOpen(id);
    const noEnter = seen.has(tool.id) ? " no-enter" : "";

    if (kind === "bash") {
      const item = h("div", { class: `tool-compact-item tool-kind-bash${open ? " open" : ""}${noEnter}`, "data-tool": tool.id });
      const line = h("button", { class: "tool-compact-line", type: "button", "aria-expanded": String(open), "aria-label": tr("展开命令和输出", "Show command and output"), title: subject.name },
        hideIcon ? null : h("span", { class: "tool-compact-icon", "aria-hidden": "true", html: ICON.terminal() }),
        hideAction ? null : h("span", { class: "tool-compact-action" }, tr("已运行", "Ran")),
        h("span", { class: "tool-compact-cmd" }, subject.name),
        iconEl(chevron("tool-compact-chevron")),
        ToolDurationLabel(tool),
        CompactStatus(running, failed));
      const collapse = ToolCollapse(open, () => h("div", { class: "tool-compact-out" },
        ScrollFade("tool-details-scroll", "", BashView({ command: activity.command, output: activity.body, running, failed })).el));
      line.addEventListener("click", () => {
        open = !open;
        fold.set(id, open);
        item.classList.toggle("open", open);
        line.setAttribute("aria-expanded", String(open));
        collapse.set(open);
      });
      item.append(line, collapse.el);
      return item;
    }

    // 文件类:read 只读一行,edit / write 有 diff 展开
    const hasFileDetails = kind === "edit" || kind === "write";
    const hasCompactDiff = hasFileDetails && Boolean(activity.diff) && !failed;
    const previewPath = (activity.path || "").trim() || null;
    const item = h("div", { class: `tool-compact-item tool-kind-${kind}${hasFileDetails && open ? " open" : ""}${noEnter}`, "data-tool": tool.id });
    const line = h("div", { class: "tool-compact-line" });
    const toggle = () => { open = !open; fold.set(id, open); refresh(); collapse && collapse.set(open); };
    function refresh() {
      const diffPreview = hasCompactDiff && open;
      item.classList.toggle("open", hasFileDetails && open);
      fill(line, 
        hideIcon ? null : h("span", { class: "tool-compact-icon", "aria-hidden": "true", html: { read: ICON.eye, edit: ICON.pencil, write: ICON.filePlus }[kind]() }),
        hideAction ? null : hasFileDetails
          ? h("button", { class: "tool-compact-text-toggle tool-compact-action-toggle", type: "button", "aria-expanded": String(open), onClick: toggle }, h("span", { class: "tool-compact-action" }, compactAction(kind)))
          : h("span", { class: "tool-compact-action" }, compactAction(kind)),
        FileTypeIcon(previewPath || subject.name),
        previewPath
          ? h("button", { class: "tool-compact-name", type: "button", title: `${tr("预览", "Preview")} ${previewPath}`, onClick: () => openPreview(previewPath) }, subject.name)
          : h("span", { class: "tool-compact-name is-static" }, subject.name),
        hasFileDetails && subject.dir
          ? h("button", { class: "tool-compact-text-toggle tool-compact-path-toggle", type: "button", "aria-expanded": String(open), title: subject.dir, onClick: toggle }, h("span", { class: "tool-compact-dir" }, subject.dir))
          : !hasFileDetails ? h("span", { class: "tool-compact-dir" }, subject.dir) : null,
        hasFileDetails ? h("button", { class: "tool-compact-detail-toggle", type: "button", "aria-expanded": String(open), "aria-label": open ? tr("收起文件差异", "Hide file diff") : tr("展开文件差异", "Show file diff"), title: open ? tr("收起差异", "Hide diff") : tr("查看差异", "View diff"), onClick: toggle }, iconEl(chevron("tool-compact-chevron"))) : null,
        stat && !diffPreview ? StatSpan(stat, "tool-compact-stat") : null,
        ToolDurationLabel(tool),
        CompactStatus(running, failed));
    }
    let collapse = null;
    if (hasFileDetails) {
      collapse = ToolCollapse(open, () => {
        const wrap = h("div", { class: `tool-compact-file-detail${hasCompactDiff ? " has-diff-preview" : ""}` });
        if (hasCompactDiff) wrap.append(CompactDiffCard({ fileName: subject.name, diff: activity.diff, note: activity.body }));
        else wrap.append(h("div", { class: "tool-error tool-markdown" }, activity.body || tr("执行失败", "Execution failed")));
        // 展开 diff 预览时,详情区的外边距由 .has-diff-preview 控制;这里只需要同步 refresh 的状态
        return wrap;
      });
    }
    refresh();
    item.append(line);
    if (collapse) item.append(collapse.el);
    return item;
  }

  /* ───────────────────────── CompactToolGroup:一段连续工具折成一行摘要 ───────────────────────── */
  function CompactToolGroup(tools, sequenceId) {
    const id = foldSeq(sequenceId);
    let open = isOpen(id);
    const running = tools.some((t) => t.status === "running");
    const failed = tools.filter((t) => t.status === "error").length;
    const parts = compactSummaryParts(tools);
    const stat = totalDiffStat(tools);
    const uniform = parts.length === 1 ? parts[0].kind : null;
    const label = parts.map(compactPartLabel).join(" · ");
    const fileTools = tools.filter((t) => compactKind(t.name) === uniform && t.activity && t.activity.path);
    const uniqueFiles = fileTools.filter((t, i) => fileTools.findIndex((c) => c.activity.path.replaceAll("\\", "/") === t.activity.path.replaceAll("\\", "/")) === i);
    const samples = uniform === "bash" ? [] : uniqueFiles.map((t) => splitPath(t.activity.path).name).slice(0, 2);
    const extra = Math.max(0, uniqueFiles.length - samples.length);
    const sampleLabel = uniform === "bash"
      ? ((tools[0].activity.command || "").replace(/\s+/g, " ").trim())
      : samples.length ? `${samples.join(", ")}${extra > 0 ? ` +${extra}` : ""}` : "";
    const fileDiffGroup = uniform === "edit" || uniform === "write";
    const duration = toolsDuration(tools);

    const group = h("div", { class: `tool-compact-group tool-kind-${uniform || "other"}${open ? " open" : ""}${running ? " is-running" : ""}${seen.has(tools[0].id) ? " no-enter" : ""}`, "data-seq": sequenceId });
    const summary = h("button", { class: "tool-compact-summary", type: "button", "aria-expanded": String(open), title: sampleLabel ? `${label} · ${sampleLabel}` : label });
    const renderSummary = () => {
      summary.setAttribute("aria-expanded", String(open));
      fill(summary, 
        h("span", { class: "tool-compact-icon", "aria-hidden": "true", html: uniform ? { bash: ICON.terminal, read: ICON.eye, edit: ICON.pencil, write: ICON.filePlus }[uniform]() : ICON.stack() }),
        h("span", { class: "tool-compact-label" }, label),
        sampleLabel && !(open && fileDiffGroup) ? h("span", { class: "tool-compact-sample" }, sampleLabel) : null,
        failed > 0 ? h("span", { class: "tool-compact-failed" }, trf("{0} 失败", "{0} failed", failed)) : null,
        stat && !(open && fileDiffGroup) ? StatSpan(stat, "tool-compact-stat") : null,
        iconEl(chevron("tool-compact-chevron")),
        prefs.details ? h("span", { class: "tool-compact-steps" }, trf("{0} 步", "{0} steps", tools.length), DurationLabel(duration)) : null,
        running ? ActivityIndicator() : null);
    };
    renderSummary();
    const collapse = ToolCollapse(open, () => h("div", { class: "tool-compact-lines" },
      tools.map((t) => CompactToolLine(t, { hideAction: Boolean(uniform), hideIcon: Boolean(uniform) }))));
    summary.addEventListener("click", () => {
      open = !open;
      fold.set(id, open);
      group.classList.toggle("open", open);
      renderSummary();
      collapse.set(open);
    });
    group.append(summary, collapse.el);
    return group;
  }

  /* ───────────────────────── 子代理 / 其他卡片 ───────────────────────── */
  function AgentToolCard(tool) {
    const id = foldRow(tool.id);
    let open = isOpen(id);
    const a = tool.activity;
    const title = a.agentPath;
    const label = { explore: tr("查阅", "Explore"), general: tr("执行", "General") }[a.agent] || tr("子代理", "Subagent");
    const summaryLabel = () => (open ? tr("收起任务概况", "Collapse summary") : tr("展开任务概况", "Expand summary"));
    const item = h("div", { class: `tool-compact-item tool-kind-other agent-compact${open ? " open" : ""}${seen.has(tool.id) ? " no-enter" : ""}` });
    const toggle = () => { open = !open; fold.set(id, open); item.classList.toggle("open", open); collapse.set(open); item.querySelectorAll(".agent-compact-toggle").forEach((b) => { b.setAttribute("aria-expanded", String(open)); b.title = summaryLabel(); }); };
    const status = a.agentStatus === "completed" ? h("span", { class: "agent-status-dot is-completed", role: "img", "aria-label": tr("已完成", "Completed") }) : ActivityIndicator();
    const line = h("div", { class: "tool-compact-line agent-compact-line", onClick: (e) => { if (e.target.closest(".agent-compact-name")) return; toggle(); } },
      h("button", { class: "agent-compact-toggle is-lead", type: "button", "aria-expanded": String(open), title: summaryLabel() },
        h("span", { class: "tool-compact-icon", "aria-hidden": "true", html: ICON.subagent() }),
        h("span", { class: "tool-compact-action" }, label)),
      h("button", { class: "agent-compact-name", type: "button", title: trf("在右侧查看 {0}", "Open {0} in pane", title), onClick: () => toast(trf("在右侧 Pane 打开 {0}", "Open {0} in pane", title)) }, title),
      h("button", { class: "agent-compact-toggle is-tail", type: "button", "aria-expanded": String(open), title: summaryLabel() }, iconEl(chevron("tool-compact-chevron")), status),
      ToolDurationLabel(tool));
    const collapse = ToolCollapse(open, () => h("div", { class: "tool-compact-out agent-compact-out" },
      ScrollFade("agent-summary-scroll", "process-thinking-text agent-summary-text", h("div", null,
        h("div", { class: "agent-summary-task" }, markdown(a.task)),
        h("div", { class: "agent-summary-report" }, markdown(a.report)))).el));
    item.append(line, collapse.el);
    return item;
  }

  function PlanStatusIcon(status, cls) {
    return h("span", { class: `plan-status-icon is-${status}${cls ? " " + cls : ""}`, "aria-hidden": "true", html: status === "completed" ? ICON.check(11) : status === "in_progress" ? ICON.arrowRight(11) : ICON.circle(11) });
  }
  /** 不可折叠的工具(update_plan 等)在紧凑列表里仍是卡片结构,只是被 .is-compact 压成一行。 */
  function GenericToolCard(tool) {
    const id = foldRow(tool.id);
    let open = isOpen(id);
    const activity = tool.activity;
    const kind = toolKind(tool.name);
    const subject = subjectOf(kind, activity, tool.name);
    const first = activity.plan && activity.plan[0];
    const card = h("article", { class: `tool-card tool-kind-${kind} is-${tool.status}${open ? " open" : ""}${seen.has(tool.id) ? " no-enter" : ""}` });
    const head = h("button", { class: "tool-card-head", type: "button", "aria-expanded": String(open), title: subject.name },
      h("span", { class: "tool-card-icon", "aria-hidden": "true", html: ICON.tool() }),
      h("span", { class: "tool-kind-label" }, toolLabel(tool.name, kind)),
      h("span", { class: "tool-card-main" }, h("span", { class: `tool-card-name${subject.dir ? "" : " grow"}` }, first ? PlanStatusIcon(first.status, "plan-status-inline") : null, subject.name)),
      iconEl(chevron("tool-chevron")),
      ToolDurationLabel(tool),
      StatusMark(tool.status));
    const collapse = ToolCollapse(open, () => h("div", { class: "tool-card-body" }, ScrollFade("tool-details-scroll", "",
      h("div", { class: "plan-checklist", role: "list" }, (activity.plan || []).map((item) =>
        h("div", { class: `plan-checklist-item is-${item.status}`, role: "listitem" }, PlanStatusIcon(item.status, "plan-checklist-icon"), h("span", { class: "plan-checklist-text" }, item.text))))).el));
    head.addEventListener("click", () => { open = !open; fold.set(id, open); card.classList.toggle("open", open); head.setAttribute("aria-expanded", String(open)); collapse.set(open); });
    card.append(h("div", { class: "tool-card-top" }, head), collapse.el);
    return card;
  }

  function ToolCard(tool) {
    return isAgentTool(tool.name) ? AgentToolCard(tool) : GenericToolCard(tool);
  }

  /** toolFold = "message":每条 assistant 消息自己的工具列表。 */
  function ToolList(tools) {
    const list = h("div", { class: "tool-card-list is-compact" });
    for (const segment of splitToolRuns(tools)) {
      if (toolKind(segment[0].name) === "other") segment.forEach((t) => list.append(ToolCard(t)));
      else if (shouldFoldRun(segment.length, "compact")) list.append(CompactToolGroup(segment, segment[0].id));
      else list.append(CompactToolLine(segment[0]));
    }
    return list;
  }

  /* ───────────────────────── Thinking ───────────────────────── */
  function Thinking({ id, text, active }) {
    const key = foldRow(`thinking:${id}`);
    // 进行中默认展开;结束后默认折叠;用户手动开合后以记忆为准
    let open = fold.has(key) ? fold.get(key) : active;
    const block = h("div", { class: `time-spent-collapsible thinking-block${open ? " expanded" : ""}` });
    const trigger = h("button", { class: `time-spent-trigger${active ? " is-running" : ""}`, type: "button", "aria-expanded": String(open) },
      h("span", { class: "thinking-icon", "aria-hidden": "true", html: ICON.thinking() }), h("span", null, tr("思考", "Thinking")), iconEl(chevron("time-spent-trigger-arrow")), active ? ActivityIndicator() : null);
    const fade = ScrollFade("", "", markdown(text), (viewport) => { if (active && !viewport.dataset.free) viewport.scrollTop = viewport.scrollHeight; });
    fade.viewport.addEventListener("wheel", () => { fade.viewport.dataset.free = "1"; }, { passive: true });
    const body = h("div", { class: "time-spent-body", "aria-hidden": String(!open) }, h("div", { class: "time-spent-body-inner" }, fade.el));
    if (!open) body.setAttribute("inert", "");
    trigger.addEventListener("click", () => {
      open = !open;
      fold.set(key, open);
      block.classList.toggle("expanded", open);
      trigger.setAttribute("aria-expanded", String(open));
      body.setAttribute("aria-hidden", String(!open));
      if (open) body.removeAttribute("inert"); else body.setAttribute("inert", "");
      fade.sync();
    });
    block.append(h("div", { class: "thinking-header" }, trigger), body);
    return block;
  }

  /* ───────────────────────── 回复、操作行、文件统计卡 ───────────────────────── */
  const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

  function ReplyActions({ text, timestamp }) {
    const copyBtn = h("button", { class: "reply-action", type: "button", title: tr("复制回复", "Copy reply"), "aria-label": tr("复制回复", "Copy reply"), html: `${ICON.copy(13)}<span>${tr("复制", "Copy")}</span>` });
    copyBtn.addEventListener("click", () => {
      navigator.clipboard && navigator.clipboard.writeText(text).catch(() => {});
      copyBtn.innerHTML = `${ICON.check(13)}<span>${tr("已复制", "Copied")}</span>`;
      setTimeout(() => (copyBtn.innerHTML = `${ICON.copy(13)}<span>${tr("复制", "Copy")}</span>`), 1400);
    });
    return h("div", { class: "reply-actions" },
      copyBtn,
      h("button", { class: "reply-action", type: "button", title: tr("保留这条回复及之前的对话，在新聊天里继续", "Keep this reply and the conversation before it, then continue in a new chat"), html: `${ICON.branch(13)}<span>${tr("分支到新聊天", "Branch to new chat")}</span>` }),
      h("button", { class: "reply-action", type: "button", title: tr("回到这一轮结束时，或从这里分叉并恢复文件", "Return to the end of this turn, or fork from here with its files"), html: `${ICON.history(13)}<span>${tr("检查点", "Checkpoint")}</span>` }),
      timestamp ? h("time", { class: "reply-time" }, fmtTime(timestamp)) : null);
  }

  function TurnChangesCard(changes) {
    let showAll = false;
    const body = h("div", { class: "turn-changes-body" });
    const render = () => {
      const files = showAll ? changes.files : changes.files.slice(0, 3);
      const remaining = changes.files.length - 3;
      fill(body, 
        ...files.map((f) => h("div", { class: "turn-changes-file" },
          h("button", { class: "turn-changes-path", type: "button", title: `${tr("预览", "Preview")} ${f.path}`, onClick: () => openPreview(f.path) }, f.path),
          h("span", { class: "turn-changes-file-stat" }, h("span", { class: "turn-changes-added" }, `+${f.added}`), h("span", { class: "turn-changes-removed" }, `−${f.removed}`)))),
        remaining > 0 ? h("button", { class: "turn-changes-more", type: "button", "aria-expanded": String(showAll), onClick: () => { showAll = !showAll; render(); } },
          showAll ? tr("收起文件", "Show fewer files") : trf("再显示 {0} 个文件", "Show {0} more files", remaining),
          iconEl(ICON.chevronDown(13, showAll ? "is-up" : ""))) : null);
    };
    render();
    return h("section", { class: "turn-changes", "aria-label": tr("本轮文件变更统计", "File changes in this turn") },
      h("header", { class: "turn-changes-header" },
        h("span", { class: "turn-changes-icon", "aria-hidden": "true", html: ICON.fileChange() }),
        h("div", { class: "turn-changes-summary" },
          h("strong", null, trf("已编辑 {0} 个文件", "Edited {0} files", changes.files.length)),
          h("span", { class: "turn-changes-total" }, h("span", { class: "turn-changes-added" }, `+${changes.added}`), h("span", { class: "turn-changes-removed" }, `−${changes.removed}`))),
        h("div", { class: "turn-changes-actions" },
          h("button", { class: "turn-changes-undo", type: "button", onClick: () => toast(tr("在工作区变更中选择文件并确认撤销", "Choose files in Workspace Changes to confirm reverting")) }, tr("撤销", "Revert"), " ", iconEl(ICON.undo())),
          h("button", { class: "turn-changes-review", type: "button", onClick: () => toast(tr("打开本轮审查", "Open this turn's review")) }, tr("审查", "Review")))),
      body);
  }

  /* ───────────────────────── 一条 assistant 消息 / 一整轮 ───────────────────────── */
  const Prose = (text, streaming) => h("div", { class: "agent-reply-prose" }, markdown(text, { entering: streaming }));

  function AssistantMessageContent(message, { active, showText = true }) {
    return [
      message.thinking ? Thinking({ id: message.id, text: message.thinking, active: active && !message.text && message.tools.length === 0 }) : null,
      message.tools.length ? ToolList(message.tools) : null,
      showText && message.text ? Prose(message.text, active) : null,
    ];
  }

  /** toolFold = "position":整轮拍平后,思考 / 正文打断工具分组,相邻工具合并成一段。 */
  function ToolSequence(messages, { includeText, activeId }) {
    const nodes = groupProcessItems(buildTurnItems(messages, includeText), "compact");
    const byId = new Map(messages.map((m) => [m.id, m]));
    const out = [];
    let buffer = [];
    const flush = () => {
      if (!buffer.length) return;
      out.push(h("div", { class: "tool-card-list is-compact" }, buffer.map((n) =>
        n.type === "run" ? CompactToolGroup(n.tools, n.id)
          : compactKind(n.tool.name) ? CompactToolLine(n.tool) : ToolCard(n.tool))));
      buffer = [];
    };
    for (const node of nodes) {
      if (node.type === "tool" || node.type === "run") { buffer.push(node); continue; }
      flush();
      if (node.type === "thinking") {
        const m = byId.get(node.messageId);
        out.push(Thinking({ id: node.messageId, text: node.text, active: node.messageId === activeId && m && !m.text && m.tools.length === 0 }));
      } else out.push(Prose(node.text, node.messageId === activeId));
    }
    flush();
    return out;
  }

  function CompletedAssistantTurn(turn) {
    const msgs = turn.assistants;
    const finalReply = [...msgs].reverse().find((m) => m.text.trim());
    const key = foldSeq(`turn:${msgs[0].id}`);
    let expanded = isOpen(key);
    const started = msgs[0].turnStartedAt;
    const completed = msgs[msgs.length - 1].turnCompletedAt;
    const allTools = msgs.flatMap((m) => m.tools);
    const total = prefs.details ? toolsDuration(allTools) : null;
    const elapsed = formatElapsed(total != null ? total : completed - started);
    const hasProcess = true;
    const article = h("article", { class: `assistant-block assistant-turn${seen.has(msgs[0].id) ? "" : " message-enter"}` });
    const wrap = h("div", { class: `time-spent-collapsible${expanded ? " expanded" : ""}` });
    const trigger = h("button", { class: "time-spent-trigger assistant-turn-trigger", type: "button", "aria-expanded": String(expanded) },
      h("span", null, trf("用时 {0}", "Took {0}", elapsed)), hasProcess ? iconEl(chevron("time-spent-trigger-arrow")) : null);
    const inner = h("div", { class: "time-spent-body-inner" });
    const body = h("div", { class: "time-spent-body", "aria-hidden": String(!expanded) }, inner);
    let mounted = false;
    const mount = () => {
      if (mounted) return;
      mounted = true;
      if (prefs.toolFold === "position") {
        inner.append(h("article", { class: "assistant-block assistant-turn-process-item" }, ToolSequence(msgs, { includeText: (m) => m.id !== finalReply.id })));
      } else {
        for (const m of msgs) inner.append(h("article", { class: "assistant-block assistant-turn-process-item" }, AssistantMessageContent(m, { active: false, showText: m.id !== finalReply.id })));
      }
    };
    const sync = () => {
      wrap.classList.toggle("expanded", expanded);
      trigger.setAttribute("aria-expanded", String(expanded));
      body.setAttribute("aria-hidden", String(!expanded));
      if (expanded) { body.removeAttribute("inert"); mount(); } else body.setAttribute("inert", "");
    };
    trigger.addEventListener("click", () => { expanded = !expanded; fold.set(key, expanded); sync(); });
    wrap.append(trigger, body);
    sync();
    article.append(wrap, Prose(finalReply.text, false), ReplyActions({ text: finalReply.text, timestamp: completed }));
    if (turn.changes) article.append(TurnChangesCard(turn.changes));
    return article;
  }

  /** 进行中的轮次:顶部「已处理 xx」计时,每条 assistant 消息各自展示思考与工具。 */
  function LiveAssistantTurn(turn, activeId, startedAt) {
    const live = h("div", { class: "assistant-live-turn" });
    live.append(h("span", { class: "time-spent-trigger assistant-turn-trigger live-elapsed", "data-started": String(startedAt) }, trf("已处理 {0}", "Worked {0}", formatElapsed(Date.now() - startedAt))));
    if (prefs.toolFold === "position") {
      live.append(h("article", { class: "assistant-block" }, ToolSequence(turn.assistants, { activeId })));
    } else {
      for (const m of turn.assistants) {
        live.append(h("article", { class: `assistant-block${seen.has(m.id) ? "" : " message-enter"}` }, AssistantMessageContent(m, { active: m.id === activeId })));
      }
    }
    return live;
  }

  function UserMessage(message) {
    const copyBtn = h("button", { class: "reply-action user-message-action", type: "button", title: tr("复制消息", "Copy message"), "aria-label": tr("复制消息", "Copy message"), html: ICON.copy(13) });
    copyBtn.addEventListener("click", () => {
      navigator.clipboard && navigator.clipboard.writeText(message.text).catch(() => {});
      copyBtn.innerHTML = ICON.check(13);
      setTimeout(() => (copyBtn.innerHTML = ICON.copy(13)), 1400);
    });
    return h("div", { class: `user-msg-container${seen.has(message.id) ? "" : " message-enter"}` },
      h("div", { class: "user-bubble" }, markdown(message.text)),
      h("div", { class: "user-message-actions" },
        h("time", null, fmtTime(message.timestamp)),
        copyBtn,
        h("button", { class: "reply-action user-message-action", type: "button", title: tr("修改消息", "Edit message"), "aria-label": tr("修改消息", "Edit message"), html: ICON.pencil(13) })));
  }

  /* ───────────────────────── 演示数据 ───────────────────────── */
  const D = (lines) => lines.join("\n");
  const T0 = Date.now() - 6 * 60 * 1000;
  const DATA = () => [
    {
      id: "turn-1",
      user: { id: "u1", text: tr("把 `session-host.ts` 里的重试逻辑抽成独立模块，补上单元测试并跑通。", "Extract the retry logic in `session-host.ts` into its own module, add unit tests, and get them passing."), timestamp: T0 },
      assistants: [
        {
          id: "a1", turnStartedAt: T0, thinking: tr("先看现有的重试逻辑在哪里，再决定怎么拆。\n\n需要确认 `retryOnce` 的调用点、现有测试覆盖，以及运行时是否也依赖它。", "First find where the retry logic lives, then decide how to split it.\n\nI need the call sites of `retryOnce`, the existing test coverage, and whether the runtime depends on it."),
          tools: [
            { id: "t1", name: "read", status: "done", durationMs: 120, activity: { path: "apps/desktop/src/main/session-host.ts", body: "…" } },
            { id: "t2", name: "read", status: "done", durationMs: 95, activity: { path: "packages/agent/src/runtime.ts", body: "…" } },
            { id: "t3", name: "read", status: "done", durationMs: 80, activity: { path: "apps/desktop/test/session-host.test.ts", body: "…" } },
            { id: "t4", name: "bash", status: "done", durationMs: 340, activity: { command: 'rg -n "retryOnce" apps packages', body: D(["apps/desktop/src/main/session-host.ts:88:  return retryOnce(() => this.start(), 3);", "apps/desktop/src/main/session-host.ts:131:  await retryOnce(() => this.reconnect(), 2);", "packages/agent/src/runtime.ts:402:    const result = await retryOnce(run, 1);"]) } },
          ],
          text: tr("`retryOnce` 有 3 处调用，没有独立测试。开始抽取。", "`retryOnce` has 3 call sites and no dedicated tests. Starting the extraction."),
        },
        {
          id: "a2", thinking: tr("新模块只负责「重试几次、间隔多久、哪些错误可重试」，不碰会话状态。", "The new module only decides how many retries, how long to wait, and which errors are retryable. It never touches session state."),
          tools: [
            { id: "t5", name: "write", status: "done", durationMs: 210, activity: { path: "apps/desktop/src/main/retry-policy.ts", body: tr("已创建 `retry-policy.ts`", "Created `retry-policy.ts`"), diff: D([
              "+  1 export interface RetryPolicy {",
              "+  2   attempts: number;",
              "+  3   delayMs: (attempt: number) => number;",
              "+  4   retryable: (error: unknown) => boolean;",
              "+  5 }",
              "+  6 ",
              "+  7 export const defaultPolicy: RetryPolicy = {",
              "+  8   attempts: 3,",
              "+  9   delayMs: (attempt) => 200 * 2 ** attempt,",
              "+ 10   retryable: (error) => !(error instanceof TypeError),",
              "+ 11 };"]) } },
            { id: "t6", name: "edit", status: "done", durationMs: 180, activity: { path: "apps/desktop/src/main/session-host.ts", diff: D([
              "  12 import { Session } from \"./session\";",
              "+ 13 import { defaultPolicy, type RetryPolicy } from \"./retry-policy\";",
              "  14 ",
              "...",
              "  86   private async open() {",
              "- 87     // retry up to 3 times",
              "- 88     return retryOnce(() => this.start(), 3);",
              "+ 87     return withRetry(() => this.start(), defaultPolicy);",
              "  88   }"]) } },
            { id: "t7", name: "write", status: "done", durationMs: 160, activity: { path: "apps/desktop/test/retry-policy.test.ts", diff: D([
              "+  1 import { describe, expect, it } from \"vitest\";",
              "+  2 import { defaultPolicy } from \"../src/main/retry-policy\";",
              "+  3 ",
              "+  4 describe(\"defaultPolicy\", () => {",
              "+  5   it(\"backs off exponentially\", () => {",
              "+  6     expect(defaultPolicy.delayMs(2)).toBe(800);",
              "+  7   });",
              "+  8 });"]) } },
          ],
          text: "",
        },
        {
          id: "a3", thinking: "",
          tools: [
            { id: "t8", name: "edit", status: "done", durationMs: 90, activity: { path: "packages/agent/src/runtime.ts", diff: D(["  400   const run = () => this.step();", "- 401   const result = await retryOnce(run, 1);", "+ 401   const result = await withRetry(run, { ...defaultPolicy, attempts: 1 });"]) } },
            { id: "t9", name: "edit", status: "done", durationMs: 70, activity: { path: "apps/desktop/src/main/index.ts", diff: D(["  9 export * from \"./session-host\";", "+ 10 export * from \"./retry-policy\";"]) } },
            { id: "t10", name: "edit", status: "done", durationMs: 70, activity: { path: "packages/agent/src/index.ts", diff: D(["  21 export { Runtime } from \"./runtime\";", "+ 22 export type { RetryPolicy } from \"../../apps/desktop/src/main/retry-policy\";"]) } },
          ],
          text: "",
        },
        {
          id: "a4", thinking: "",
          tools: [
            { id: "t11", name: "bash", status: "error", durationMs: 4200, activity: { command: "pnpm --filter @vela/desktop test retry-policy", body: D(["FAIL  test/retry-policy.test.ts > defaultPolicy > backs off exponentially", "AssertionError: expected 400 to be 800", "  at test/retry-policy.test.ts:6:46"]) } },
            { id: "t12", name: "bash", status: "done", durationMs: 3900, activity: { command: "pnpm --filter @vela/desktop test retry-policy", body: D(["✓ test/retry-policy.test.ts (1)", "", "Test Files  1 passed (1)", "     Tests  1 passed (1)"]) } },
          ],
          text: "",
        },
        {
          id: "a5", thinking: "",
          tools: [
            { id: "t13", name: "update_plan", status: "done", durationMs: 20, activity: { plan: [
              { text: tr("抽出 retry-policy 模块", "Extract the retry-policy module"), status: "completed" },
              { text: tr("替换 session-host 与 runtime 的调用", "Replace the calls in session-host and runtime"), status: "completed" },
              { text: tr("补单元测试并跑通", "Add unit tests and get them passing"), status: "completed" }] } },
            { id: "t14", name: "task", status: "done", durationMs: 12800, activity: { agent: "explore", agentPath: "/root/regression-scan", agentStatus: "completed",
              task: tr("检查是否还有遗漏的 `retryOnce` 调用。", "Check for any remaining `retryOnce` calls."),
              report: tr("全仓库已无 `retryOnce` 引用；`withRetry` 共 3 处调用，签名一致。", "No `retryOnce` references remain; `withRetry` has 3 call sites with consistent signatures.") } },
            { id: "t15", name: "read", status: "done", durationMs: 60, activity: { path: "apps/desktop/src/main/retry-policy.ts", body: "…" } },
          ],
          turnCompletedAt: T0 + 38000,
          text: D([
            tr("**重试逻辑已抽出。** 新模块 `apps/desktop/src/main/retry-policy.ts` 只负责重试策略，调用点都已替换。", "**The retry logic is extracted.** The new module `apps/desktop/src/main/retry-policy.ts` only owns the retry policy, and every call site is updated."),
            "",
            tr("- 策略：默认 3 次，指数退避，`TypeError` 不重试", "- Policy: 3 attempts by default, exponential backoff, `TypeError` is not retried"),
            tr("- 调用点：`session-host.ts`、`runtime.ts` 已迁移", "- Call sites: `session-host.ts` and `runtime.ts` are migrated"),
            tr("- 测试：`retry-policy.test.ts` 通过", "- Tests: `retry-policy.test.ts` passes"),
            "",
            "```ts",
            "export const defaultPolicy: RetryPolicy = {",
            "  attempts: 3,",
            "  delayMs: (attempt) => 200 * 2 ** attempt,",
            "};",
            "```",
            "",
            tr("| 文件 | 改动 |", "| File | Change |"),
            "| --- | --- |",
            tr("| `retry-policy.ts` | 新增 |", "| `retry-policy.ts` | New |"),
            tr("| `session-host.ts` | 改用 `withRetry` |", "| `session-host.ts` | Uses `withRetry` |"),
          ]),
        },
      ],
      changes: { added: 28, removed: 4, files: [
        { path: "apps/desktop/src/main/retry-policy.ts", added: 11, removed: 0 },
        { path: "apps/desktop/src/main/session-host.ts", added: 2, removed: 2 },
        { path: "apps/desktop/test/retry-policy.test.ts", added: 8, removed: 0 },
        { path: "packages/agent/src/runtime.ts", added: 1, removed: 1 },
        { path: "apps/desktop/src/main/index.ts", added: 1, removed: 0 },
        { path: "packages/agent/src/index.ts", added: 1, removed: 0 },
      ] },
    },
  ];

  /** 演示「流式」的第二轮:每一步追加数据后重绘。 */
  function liveScript() {
    const now = Date.now();
    const user = { id: "u2", text: tr("再把默认策略的单测补全:不可重试的错误应该立刻抛出。", "Also add tests for the default policy: non-retryable errors should be thrown immediately."), timestamp: now };
    const a1 = { id: "b1", turnStartedAt: now, thinking: "", tools: [], text: "" };
    const a2 = { id: "b2", thinking: "", tools: [], text: "" };
    const steps = [
      [0, (c) => { c.user = user; c.assistants = [a1]; }],
      [500, () => { a1.thinking = tr("需要补两个用例:", "Two cases to add:"); }],
      [800, () => { a1.thinking += tr("\n\n1. `TypeError` 不重试，直接抛出。\n2. 其余错误按退避重试到上限。", "\n\n1. `TypeError` is not retried and is thrown right away.\n2. Other errors are retried with backoff up to the limit."); }],
      [1000, () => { a1.tools.push({ id: "n1", name: "read", status: "running", activity: { path: "apps/desktop/test/retry-policy.test.ts" } }); }],
      [900, () => { Object.assign(a1.tools[0], { status: "done", durationMs: 90 }); a1.tools.push({ id: "n2", name: "read", status: "running", activity: { path: "apps/desktop/src/main/retry-policy.ts" } }); }],
      [900, () => { Object.assign(a1.tools[1], { status: "done", durationMs: 70 }); }],
      [600, (c) => { c.assistants.push(a2); a2.tools.push({ id: "n3", name: "edit", status: "running", activity: { path: "apps/desktop/test/retry-policy.test.ts", diff: D(["   7     expect(defaultPolicy.delayMs(2)).toBe(800);", "   8   });", "+  9   it(\"does not retry TypeError\", () => {", "+ 10     expect(defaultPolicy.retryable(new TypeError())).toBe(false);", "+ 11   });"]) } }); }],
      [1400, () => { Object.assign(a2.tools[0], { status: "done", durationMs: 140 }); a2.tools.push({ id: "n4", name: "bash", status: "running", activity: { command: "pnpm --filter @vela/desktop test retry-policy" } }); }],
      [1800, () => { Object.assign(a2.tools[1], { status: "done", durationMs: 3600, activity: { command: "pnpm --filter @vela/desktop test retry-policy", body: D(["✓ test/retry-policy.test.ts (2)", "", "Test Files  1 passed (1)", "     Tests  2 passed (2)"]) } }); }],
      [700, () => { a2.text = tr("新增 `TypeError` 用例，2 个测试全部通过。", "Added the `TypeError` case; both tests pass."); }],
      [900, () => { a2.turnCompletedAt = Date.now(); }],
    ];
    return { steps, chat: { id: "turn-2", user: null, assistants: [], changes: { added: 3, removed: 0, files: [{ path: "apps/desktop/test/retry-policy.test.ts", added: 3, removed: 0 }] } } };
  }

  /* ───────────────────────── 页面骨架与渲染循环 ───────────────────────── */
  const surface = document.getElementById("surface");
  const scroller = document.getElementById("scroller");
  const jump = document.getElementById("jump");
  let turns = DATA();
  let liveTurn = null; // { chat, running }
  let pinned = true;
  let timers = [];

  function render() {
    const prevScroll = scroller.scrollTop;
    seen = new Set(seen);
    const nodes = [];
    const all = liveTurn ? [...turns, liveTurn.chat] : turns;
    all.forEach((turn, index) => {
      if (turn.user) nodes.push(UserMessage(turn.user));
      if (!turn.assistants.length) return;
      const isLive = liveTurn && turn === liveTurn.chat && liveTurn.running;
      if (!isLive) nodes.push(CompletedAssistantTurn(turn));
      else {
        const last = turn.assistants[turn.assistants.length - 1];
        nodes.push(LiveAssistantTurn(turn, last.id, turn.assistants[0].turnStartedAt));
      }
    });
    surface.replaceChildren(...nodes);
    // 记住已展示过的节点,下一次重绘不再重放入场动画
    for (const turn of all) {
      if (turn.user) seen.add(turn.user.id);
      for (const m of turn.assistants) { seen.add(m.id); for (const t of m.tools) seen.add(t.id); }
    }
    if (pinned) scroller.scrollTop = scroller.scrollHeight; else scroller.scrollTop = prevScroll;
    syncJump();
  }

  const syncJump = () => {
    const distance = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    jump.dataset.visible = distance > 120 ? "true" : "false";
  };
  scroller.addEventListener("scroll", () => {
    const distance = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    pinned = distance < 80;
    syncJump();
    scroller.classList.add("is-scrolling");
    clearTimeout(scroller._t);
    scroller._t = setTimeout(() => scroller.classList.remove("is-scrolling"), 800);
  }, { passive: true });
  jump.addEventListener("click", () => { pinned = true; scroller.scrollTop = scroller.scrollHeight; });

  // 输入框高度 → 滚动区底部留白(--composer-clearance)
  const dock = document.querySelector(".chat-dock-wrapper");
  new ResizeObserver(() => {
    const height = dock.getBoundingClientRect().height;
    if (height > 0) document.querySelector(".main-chat-view").style.setProperty("--composer-clearance", `${Math.ceil(height + 36)}px`);
  }).observe(dock);

  // 「已处理 xx」每秒刷新
  setInterval(() => {
    document.querySelectorAll(".live-elapsed").forEach((el) => {
      el.textContent = trf("已处理 {0}", "Worked {0}", formatElapsed(Date.now() - Number(el.dataset.started)));
    });
  }, 1000);

  /* ───────────────────────── 输入框(静态外观 + 发送/停止切换) ───────────────────────── */
  const slot = document.querySelector(".composer-action-slot");
  function setStreaming(on) { slot.classList.toggle("is-streaming", on); slot.querySelector(".stop").inert = !on; }

  function replay() {
    timers.forEach(clearTimeout);
    timers = [];
    const { steps, chat } = liveScript();
    liveTurn = { chat, running: true };
    setStreaming(true);
    pinned = true;
    let at = 0;
    steps.forEach(([delay, apply], index) => {
      at += delay;
      timers.push(setTimeout(() => {
        apply(chat);
        if (index === steps.length - 1) { liveTurn.running = false; setStreaming(false); }
        render();
      }, at));
    });
  }
  document.querySelector(".stop").addEventListener("click", () => { timers.forEach(clearTimeout); if (liveTurn) { liveTurn.running = false; const last = liveTurn.chat.assistants.at(-1); if (last) { last.tools.forEach((t) => t.status === "running" && (t.status = "error")); last.text = last.text || tr("（已停止）", "(stopped)"); last.turnCompletedAt = Date.now(); } } setStreaming(false); render(); });

  /* ───────────────────────── 控制条 ───────────────────────── */
  const $ = (id) => document.getElementById(id);
  $("fold").addEventListener("change", (e) => { prefs.toolFold = e.target.value; render(); });
  $("details").addEventListener("change", (e) => { prefs.details = e.target.checked; render(); });
  $("iconColor").addEventListener("change", (e) => { prefs.iconColor = e.target.checked; document.documentElement.dataset.toolIconColor = String(prefs.iconColor); });
  $("narrow").addEventListener("change", (e) => document.getElementById("stage").classList.toggle("narrow", e.target.checked));
  $("annotate").addEventListener("change", (e) => document.body.classList.toggle("annotate", e.target.checked));
  $("lang").addEventListener("change", (e) => { lang = e.target.value; document.documentElement.lang = lang === "zh" ? "zh-CN" : "en"; chrome(); const wasLive = liveTurn; turns = DATA(); if (wasLive) liveTurn = null; render(); });
  $("replay").addEventListener("click", replay);
  $("expand").addEventListener("click", () => {
    const ids = [];
    turns.forEach((t) => { ids.push(foldSeq(`turn:${t.assistants[0].id}`)); t.assistants.forEach((m) => { ids.push(foldRow(`thinking:${m.id}`)); m.tools.forEach((tool) => ids.push(foldRow(tool.id))); splitToolRuns(m.tools).forEach((s) => ids.push(foldSeq(s[0].id))); }); });
    buildTurnItems(turns.flatMap((t) => t.assistants)).forEach((i) => i.kind === "tool" && ids.push(foldSeq(i.id)));
    ids.forEach((id) => fold.set(id, true));
    render();
  });
  $("collapse").addEventListener("click", () => { for (const k of [...fold.keys()]) fold.set(k, false); render(); });

  function chrome() {
    document.querySelectorAll("[data-zh]").forEach((el) => (el.textContent = lang === "zh" ? el.dataset.zh : el.dataset.en));
    document.querySelector(".input-textarea").placeholder = tr("随心输入", "Ask anything or describe a task");
    document.querySelector(".chat-active-title span").textContent = tr("抽取重试逻辑", "Extract retry logic");
  }

  /* ───────────────────────── 标注模式:悬停显示 class 与关键样式 ───────────────────────── */
  const tip = h("div", { class: "annotate-tip" });
  document.body.append(tip);
  document.addEventListener("mousemove", (e) => {
    if (!document.body.classList.contains("annotate")) { tip.style.display = "none"; return; }
    const el = e.target.closest(".main-chat-view *");
    if (!el || !el.classList.length) { tip.style.display = "none"; return; }
    const cs = getComputedStyle(el);
    tip.innerHTML = `<b>.${[...el.classList].join(" .")}</b><br>${cs.fontSize} / ${cs.fontWeight} · color ${cs.color}${cs.backgroundColor !== "rgba(0, 0, 0, 0)" ? `<br>bg ${cs.backgroundColor}` : ""}<br>gap ${cs.gap} · padding ${cs.padding}`;
    tip.style.display = "block";
    tip.style.left = `${Math.min(e.clientX + 14, innerWidth - 320)}px`;
    tip.style.top = `${Math.min(e.clientY + 14, innerHeight - 90)}px`;
  });

  // 首屏:第一轮已完成并展开过程,方便直接看到紧凑样式
  fold.set(foldSeq("turn:a1"), true);
  fold.set(foldSeq("t1"), true); // 第一组读取+命令:展开
  fold.set(foldSeq("t5"), true); // 创建/编辑组:展开
  fold.set(foldRow("t6"), true); // 一条 diff 预览
  fold.set(foldSeq("t11"), true); // 两条命令的分组:展开
  fold.set(foldRow("t11"), true); // 失败命令的输出
  chrome();
  pinned = false; // 首屏停在顶部,先看第一轮的紧凑工具行
  render();
  scroller.scrollTop = 0;
})();
