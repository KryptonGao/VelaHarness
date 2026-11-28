/** Full-text chat search through the production renderer, main process and search worker. Run `pnpm build` first. */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app, BrowserWindow } from "electron";

const temporary = realpathSync(mkdtempSync(join(tmpdir(), "vela-conversation-search-")));
const home = join(temporary, "data");
const alpha = join(temporary, "Alpha"), beta = join(temporary, "Beta");
process.env.VELA_USER_DATA = home;
process.env.VELA_CWD = alpha;
process.env.PI_OFFLINE = "1";
delete process.env.ELECTRON_RENDERER_URL;
delete process.env.VELA_CAPTURE;
mkdirSync(home);
app.setPath("userData", home);
const pause = ms => new Promise(done => setTimeout(done, ms));
const writeJson = (name, value) => writeFileSync(join(home, name), JSON.stringify(value));

async function run() {
  const { SessionManager } = await import("@earendil-works/pi-coding-agent");
  const now = Date.now();
  const text = value => [{ type: "text", text: value }];
  const seed = (cwd, title, updatedAt, build, archived = false) => {
    mkdirSync(cwd, { recursive: true });
    const manager = SessionManager.create(cwd, join(home, "sessions"));
    build(manager);
    return { id: manager.getSessionId(), cwd, hasWorkspace: true, title, createdAt: updatedAt, updatedAt,
      messageCount: 4, toolCallCount: 1, sessionFile: manager.getSessionFile(), instructions: "", mode: "agent", plans: [],
      executionPlans: [], latestProposedPlanId: null, activeExecutionPlanId: null, goal: null, archivedAt: archived ? updatedAt : null };
  };
  const turn = (manager, prompt, answer) => {
    manager.appendMessage({ role: "user", content: prompt, timestamp: Date.now() });
    manager.appendMessage({ role: "assistant", content: text(answer), stopReason: "stop", timestamp: Date.now() });
  };
  const conversations = [
    // The hit sits in the middle of a long chat, so opening it has to scroll.
    seed(alpha, "Deploy pipeline", now - 1000, manager => {
      for (let n = 0; n < 40; n += 1) turn(manager, n === 12 ? "why does the build print zebra-quartz-failure?" : `routine question ${n}`, `routine answer ${n} ${"details ".repeat(60)}`);
    }),
    seed(beta, "Shell trouble", now - 2000, manager => {
      turn(manager, "run the installer", "Running it.");
      manager.appendMessage({ role: "assistant", content: [{ type: "toolCall", id: "call-1", name: "bash", arguments: { command: "npm install --zebra-quartz-flag" } }],
        stopReason: "toolUse", timestamp: Date.now() });
      manager.appendMessage({ role: "toolResult", toolCallId: "call-1", toolName: "bash", content: text("npm ERR! zebra-quartz output ENOENT"), isError: true, timestamp: Date.now() });
      turn(manager, "thanks qj", "done");
    }),
    seed(beta, "Old archive", now - 3000, manager => turn(manager, "archived zebra-quartz discussion", "noted"), true),
  ];
  // Enough text that indexing takes a few seconds. The needle is in the chat that is indexed last (least recently updated).
  // Random CJK text has almost no repeated trigrams, which is the slowest text to index.
  const filler = () => Array.from({ length: 1500 }, () => String.fromCodePoint(0x4e00 + Math.floor(Math.random() * 20000))).join("");
  for (let chat = 0; chat < 30; chat += 1) {
    conversations.push(seed(alpha, `Notes ${chat}`, now - 100_000 - chat, manager => {
      for (let n = 0; n < 50; n += 1) turn(manager, filler(), filler());
    }));
  }
  conversations.push(seed(alpha, "Late arrival", now - 1_000_000, manager => turn(manager, "catch-up-needle", "ok")));
  writeJson("conversations.json", { version: 2, conversations });
  writeJson("ui-state.json", { "vela.onboarding.complete": "true", "vela.locale": "en", "vela.appearance": "light",
    "vela.navLayout": '"classic"', "vela.conversationWorkbenchTabs": "false", "vela.borderlessInterface": "false" });
  await import("../out/main/index.mjs");
  while (!BrowserWindow.getAllWindows().length) await pause(50);
  const win = BrowserWindow.getAllWindows()[0];
  win.setContentSize(1440, 900);
  const js = code => win.webContents.executeJavaScript(code, true);
  const until = async (expression, ms = 15000) => {
    const end = Date.now() + ms;
    do {
      if (await js(expression)) return;
      await pause(40);
    } while (Date.now() < end);
    const dialog = await js("document.querySelector('.conversation-search-dialog')?.innerText ?? '(no dialog)'");
    throw new Error(`Timed out waiting for ${expression}\n${dialog}`);
  };
  const el = selector => `document.querySelector(${JSON.stringify(selector)})`;
  const type = async value => {
    await js(`(() => { const input = document.querySelector('.conversation-search-header input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  };
  const hits = () => js(`[...document.querySelectorAll('.conversation-search-hit')].map(row => ({
    snippet: row.querySelector('.conversation-search-snippet').textContent,
    marked: [...row.querySelectorAll('mark')].map(mark => mark.textContent),
    meta: row.querySelector('.conversation-search-hit-meta').textContent,
  }))`);
  const setSelect = (label, value) => js(`(() => { const select = document.querySelector('[aria-label=${JSON.stringify(label)}]');
    select.value = ${JSON.stringify(value)}; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);

  await until("window.vela.getState().then(state => state.session.status === 'ready')");
  await until(el(".sidebar-search-trigger"));
  await js(`${el(".sidebar-search-trigger")}.click()`);
  await until(el(".conversation-search-dialog[open]"));

  // A search that starts while the index is still being built looks again once it has caught up.
  const started = Date.now();
  await type("catch-up-needle");
  await until("document.querySelectorAll('.conversation-search-hit').length === 1", 60000);
  console.log(`PASS a search made during indexing completes once indexing finishes (${Date.now() - started} ms)`);

  const capture = async name => {
    if (!process.env.VELA_SEARCH_CAPTURE) return;
    await pause(400);
    writeFileSync(join(process.env.VELA_SEARCH_CAPTURE, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  };

  // Messages, tool calls, tool output and archived chats are all found, newest message first.
  // The chats were written one after another, so the archived one holds the newest message.
  await type("zebra-quartz");
  await until("document.querySelectorAll('.conversation-search-hit').length === 4");
  const found = await hits();
  const chatOf = hit => ["Old archive", "Shell trouble", "Deploy pipeline"].find(title => hit.meta.includes(title));
  assert.deepEqual(found.map(chatOf), ["Old archive", "Shell trouble", "Shell trouble", "Deploy pipeline"]);
  assert.deepEqual(found.map(hit => hit.meta.match(/^(You|Assistant|Tool)/)[1]), ["You", "Tool", "Tool", "You"]);
  assert.ok(found.every(hit => hit.marked.some(mark => mark.toLowerCase() === "zebra-quartz")), "every snippet marks the match");
  assert.ok(found[0].meta.includes("Archived"), "archived chats are searched and labelled");
  await capture("results");
  assert.ok(found.some(hit => hit.snippet.includes("npm install --zebra-quartz-flag")), "tool call text is found");
  assert.ok(found.some(hit => hit.snippet.includes("npm ERR!")), "tool output is found");
  console.log("PASS messages, tool output and archived chats are found newest first");

  // The search runs in its own process, and the index is the one thing the main process did not build itself.
  const metrics = app.getAppMetrics().filter(metric => metric.type === "Utility");
  assert.ok(metrics.some(metric => metric.name === "Vela search index"), "the search worker is a utility process");

  // Characters in any language, and keywords shorter than three characters, work too.
  // The previous results stay up until the new search has something to show, so wait for the new text.
  const marks = "[...document.querySelectorAll('.conversation-search-hit mark')].map(mark => mark.textContent).join('|')";
  await type("ERR! ENO");
  await until(`${marks} === 'ERR!|ENO'`);
  assert.equal((await hits()).length, 1);
  assert.ok((await hits())[0].snippet.includes("npm ERR!"));
  await type("qj");
  await until(`${marks} === 'qj'`);
  assert.equal((await hits()).length, 1);
  await type("zq");
  await pause(600);
  assert.equal((await hits()).length, 0);
  console.log("PASS substring and short-keyword searches");

  // Filters narrow what streams in.
  await type("zebra-quartz");
  await until("document.querySelectorAll('.conversation-search-hit').length === 4");
  await js(`[...document.querySelectorAll('.conversation-search-chip')].find(chip => chip.textContent === 'Tool output').click()`);
  await until("document.querySelectorAll('.conversation-search-hit').length === 2");
  await js(`[...document.querySelectorAll('.conversation-search-chip')].find(chip => chip.textContent === 'Archived').click()`);
  await until("document.querySelectorAll('.conversation-search-hit').length === 1");
  await js(`[...document.querySelectorAll('.conversation-search-chip')].forEach(chip => chip.getAttribute('aria-pressed') === 'false' && chip.click())`);
  await until("document.querySelectorAll('.conversation-search-hit').length === 4");
  await setSelect("Project", `path:${beta}`);
  await until("document.querySelectorAll('.conversation-search-hit').length === 3 && ![...document.querySelectorAll('.conversation-search-hit')].some(row => row.textContent.includes('Deploy pipeline'))");
  await setSelect("Project", "all");
  await capture("filters");
  await setSelect("Date", "custom");
  const nextYear = new Date().getFullYear() + 1;
  await js(`(() => { const input = document.querySelector('[aria-label="Start date"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '${nextYear}-01-01');
    input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await until("document.querySelectorAll('.conversation-search-hit').length === 0");
  await setSelect("Date", "any");
  await until("document.querySelectorAll('.conversation-search-hit').length === 4");
  console.log("PASS filters by tool output, archive, project and date");

  // A long list fades at the edge it can still scroll toward, and only there.
  await type("routine");
  await until("document.querySelectorAll('.conversation-search-hit').length >= 8");
  const fade = () => js(`(() => { const list = document.querySelector('.conversation-search-results'); const style = getComputedStyle(list);
    return { top: style.getPropertyValue('--search-fade-top'), bottom: style.getPropertyValue('--search-fade-bottom'), overflow: list.scrollHeight > list.clientHeight }; })()`);
  const scrollList = position => js(`(() => { const list = document.querySelector('.conversation-search-results');
    list.scrollTop = ${position === "end" ? "list.scrollHeight" : position === "middle" ? "list.scrollHeight / 2 - list.clientHeight / 2" : "0"}; })()`);
  await scrollList("top"); await pause(100);
  assert.deepEqual(await fade(), { top: "0px", bottom: "20px", overflow: true });
  await scrollList("middle"); await pause(100);
  await capture("scrolled");
  assert.deepEqual(await fade(), { top: "20px", bottom: "20px", overflow: true });
  await scrollList("end"); await pause(100);
  assert.deepEqual(await fade(), { top: "20px", bottom: "0px", overflow: true });
  await scrollList("top");
  await type("zebra-quartz");
  await until("document.querySelectorAll('.conversation-search-hit').length === 4");
  await pause(100);
  assert.deepEqual(await fade(), { top: "0px", bottom: "0px", overflow: false }, "a list that fits has no fade");
  console.log("PASS the result list fades at the edges it can scroll toward");

  // Opening a hit goes to the message, not just the chat.
  const target = await js(`[...document.querySelectorAll('.conversation-search-hit')].findIndex(row => row.textContent.includes('Deploy pipeline'))`);
  assert.ok(target >= 0);
  await js(`document.querySelectorAll('.conversation-search-hit')[${target}].click()`);
  await until("!document.querySelector('.conversation-search-dialog[open]')");
  await until("window.vela.getState().then(state => state.conversations.find(c => c.id === state.activeConversationId)?.title === 'Deploy pipeline')");
  await until(`(() => {
    const turn = [...document.querySelectorAll('[data-turn-id]')].find(node => node.textContent.includes('zebra-quartz-failure'));
    if (!turn || !CSS.highlights.has('search-hit')) return false;
    const scroller = document.querySelector('.chat-scroll-area').getBoundingClientRect();
    const range = [...CSS.highlights.get('search-hit')][0].getBoundingClientRect();
    return range.height > 0 && range.top >= scroller.top && range.bottom <= scroller.bottom;
  })()`);
  console.log("PASS opening a hit scrolls the long chat to the message and highlights the match");

  // A hit in an archived chat brings the chat back, then opens it.
  await js(`${el(".sidebar-search-trigger")}.click()`);
  await until(el(".conversation-search-dialog[open]"));
  await type("archived zebra");
  await until("document.querySelectorAll('.conversation-search-hit').length === 1");
  await js(`document.querySelector('.conversation-search-hit').click()`);
  await until("window.vela.getState().then(state => { const chat = state.conversations.find(c => c.id === state.activeConversationId); return chat?.title === 'Old archive' && chat.archivedAt === null; })");
  console.log("PASS a hit in an archived chat restores and opens it");

  await win.loadURL("about:blank");
}

const watchdog = setTimeout(() => { console.error("Smoke test deadline"); app.exit(1); }, 120000);
app.whenReady().then(run).then(() => { clearTimeout(watchdog); app.quit(); }, error => {
  clearTimeout(watchdog); console.error(error); app.exit(1);
});
app.on("quit", () => rmSync(temporary, { recursive: true, force: true }));
