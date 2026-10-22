import { app } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = process.env.VELA_HANDOFF_SMOKE_ROOT, data = process.env.VELA_HANDOFF_SMOKE_TEMP;
app.setPath('userData', join(data, 'electron-data')); app.setPath('sessionData', join(data, 'electron-data'));
const deadline = setTimeout(() => { console.error('Handoff smoke deadline'); app.exit(1); }, 50000);
app.on('browser-window-created', (_event, win) => {
  win.webContents.once('did-finish-load', async () => {
    try {
      await win.webContents.executeJavaScript(`(async () => {
        const wait = async (read, message) => { for (let i = 0; i < 400; i++) { const value = await read(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 25)); } throw new Error(message); };
        const assert = (value, message) => { if (!value) throw new Error(message); };
        await wait(async () => { const s = await window.vela.getState(); return s.session.status === 'ready' && s; }, 'Runtime not ready');
        const visible = node => !!node && node.getClientRects().length;
        const buttons = scope => [...(scope ?? document).querySelectorAll('button')].filter(visible);
        const click = (text, scope) => { const b = buttons(scope).find(x => x.textContent.trim() === text); assert(b, 'Missing button ' + text); assert(!b.disabled, 'Disabled ' + text); b.click(); };
        const setValue = (el, text) => { if (el.isContentEditable) el.textContent = text; else Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, text); el.dispatchEvent(new Event('input', { bubbles: true })); };

        // Send one message and wait for the reply, so the chat has content.
        const first = await window.vela.getState();
        const sourceId = first.activeConversationId;
        await wait(() => document.querySelector('#prompt') && document.querySelector('#prompt').isContentEditable, 'Composer not ready');
        const prompt = document.querySelector('#prompt');
        prompt.focus(); setValue(prompt, 'Please build the handoff smoke feature');
        await new Promise(resolve => setTimeout(resolve, 50));
        prompt.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await wait(async () => (await window.vela.getMessages(sourceId)).some(m => m.role === 'assistant' && m.text.includes('Handoff smoke reply')), 'No reply');
        await wait(async () => (await window.vela.getState()).session.status === 'ready', 'Chat did not settle');

        // Open the dialog from the chat actions menu.
        document.querySelector('.chat-actions-anchor button').click();
        const menu = await wait(() => document.querySelector('.chat-actions-menu'), 'Chat actions menu missing');
        const item = [...menu.querySelectorAll('[role=menuitem]')].find(x => x.textContent === '生成交接包…');
        assert(item && item.getAttribute('aria-disabled') === 'false', 'Handoff item unavailable');
        item.click();
        const dialog = await wait(() => document.querySelector('.handoff-dialog[open]'), 'Dialog missing');
        const goal = await wait(() => dialog.querySelector('textarea'), 'Pack did not load');
        assert(goal.value === 'Smoke goal from the model', 'Model goal missing: ' + goal.value);
        assert(!dialog.querySelector('.handoff-notice'), 'Unexpected facts-only notice');
        assert(!dialog.textContent.includes('invented.ts'), 'Model-invented file leaked into the pack');
        assert(dialog.textContent.includes('上一个对话没有记录任何验证'), 'Missing the no-verification statement');
        setValue(goal, 'Smoke goal edited by the user');
        await new Promise(resolve => setTimeout(resolve, 50));
        click('创建新对话并填入', dialog);

        // A new chat is active, in the same workspace, with the pack in its input and the caret at the end.
        await wait(async () => (await window.vela.getState()).activeConversationId !== sourceId, 'New chat not created');
        await wait(() => !document.querySelector('.handoff-dialog'), 'Dialog did not close');
        const state = await window.vela.getState();
        assert(state.activeConversationId !== sourceId, 'Still on the source chat');
        const filled = await wait(() => { const el = document.querySelector('#prompt'); return el && el.textContent.startsWith('# 任务交接包') && el; }, 'Input not seeded');
        assert(filled.textContent.includes('Smoke goal edited by the user'), 'Edited goal missing from the input');
        assert(filled.textContent.includes('- Keep it simple') && filled.textContent.includes('- Write the docs'), 'Decisions or unfinished items missing');
        const caret = getSelection(); assert(caret.isCollapsed && caret.anchorOffset === filled.textContent.length, 'Caret not at the end');
        assert(document.activeElement === filled, 'Input not focused');
        const conversations = (await window.vela.getState()).conversations ?? [];
        const source = conversations.find(c => c.id === sourceId), created = conversations.find(c => c.id === state.activeConversationId);
        assert(!source || !created || source.cwd === created.cwd, 'New chat is in a different workspace');
        // The source chat is untouched and nothing was sent automatically.
        const sourceMessages = await window.vela.getMessages(sourceId);
        assert(sourceMessages.filter(m => m.role === 'user').length === 1, 'Source chat changed');
        assert((await window.vela.getMessages(state.activeConversationId)).length === 0, 'The pack was sent automatically');
      })()`);
      await new Promise(resolve => setTimeout(resolve, 200));
      console.log('PASS Handoff pack'); clearTimeout(deadline); app.quit();
    } catch (error) { console.error(error); clearTimeout(deadline); app.exit(1); }
  });
});
await import(pathToFileURL(join(root, 'out/main/index.mjs')).href);
