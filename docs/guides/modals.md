# Modal style guide

Every modal in the desktop renderer shares one visual system, defined in [`apps/desktop/src/renderer/styles/29-modal.css`](../../apps/desktop/src/renderer/styles/29-modal.css). A modal's own stylesheet only lays out its content. Surface, radius, shadow, scrim, title bar, buttons and form fields all come from the shared classes, so a new dialog looks like the existing ones without copying CSS.

Reference look: the **Edit workspace** dialog. Everything below was derived from it.

## Quick start

A native `<dialog>` (preferred for anything that blocks the page):

```tsx
<dialog ref={dialogRef} className="modal modal-sm my-dialog" aria-labelledby={headingId}
  onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
  <form onSubmit={submit}>
    <div className="modal-head">
      <h2 id={headingId}>{tr("重命名对话", "Rename chat")}</h2>
      <button type="button" className="modal-close" aria-label={tr("关闭", "Close")} onClick={onClose}>
        <Icon name="close" size={18} />
      </button>
    </div>
    <div className="modal-body">
      <div className="modal-field">
        <label htmlFor={inputId}>{tr("对话名称", "Chat name")}</label>
        <input id={inputId} className="modal-input" />
      </div>
      <p className="modal-hint">{tr("Enter 保存 · Esc 取消", "Enter to save · Esc to cancel")}</p>
    </div>
    <div className="modal-foot">
      <button type="button" className="modal-btn" onClick={onClose}>{tr("取消", "Cancel")}</button>
      <button type="submit" className="modal-btn modal-btn-primary">{tr("保存", "Save")}</button>
    </div>
  </form>
</dialog>
```

A modal that is not a `<dialog>` (rendered inside a `.sheet-backdrop` overlay, usually through `Presence`):

```tsx
<div className="sheet-backdrop" onMouseDown={onClose}>
  <section className="modal modal-lg sheet-card" role="dialog" aria-modal="true" aria-labelledby={id}
    onMouseDown={event => event.stopPropagation()}>
    …same modal-head / modal-body / modal-foot…
  </section>
</div>
```

`sheet-card` is kept only as the hook for the enter and leave animation in `styles/17-motion.css`. It carries no visuals.

## Design spec

| Property | Value | Token or class |
| --- | --- | --- |
| Surface | `--bg-elevated`, 1px `--border-subtle` | `.modal` |
| Radius | 20px | `--modal-radius` (`--radius-xl`) |
| Shadow | `0 16px 60px rgba(0, 0, 0, 0.24)` | `--modal-shadow` |
| Scrim | `rgba(0, 0, 0, 0.35)` | `--modal-scrim`, used by `.modal::backdrop` and `.sheet-backdrop` |
| Padding | 24px on the title bar, body and button bar | `--modal-pad` |
| Title | 20px, weight 600, `h2` | `.modal-head h2` |
| Subtitle | 13px, `--text-muted`, a `p` inside `.modal-head` | `.modal-head p` |
| Close button | 34px circle, 18px `close` icon | `.modal-close` |
| Body text | 14px, line-height 1.55 | `.modal-body` |
| Buttons | 9px 16px, 14px, weight 500, radius 16px | `.modal-btn` |
| Field | 10px 14px, 14px, radius 16px, `--bg-chat`, 1px `--border-subtle` | `.modal-input` |
| Focus | 2px `--accent-blue` outline | `.modal :focus-visible` |

Sizes set `--modal-width`. The width is capped at `100vw - 40px`, and the height at `100vh - 40px`.

| Class | Width | Use |
| --- | --- | --- |
| *(none)* | 480px | Default: edit forms, settings |
| `.modal-sm` | 420px | Sign-in, rename, confirmations |
| `.modal-lg` | 640px | Lists, checkpoints, detail views |
| `.modal-xl` | 760px | Wide panels: race, handoff, memory distill, conflicts |

For any other width, set `--modal-width` on your own class (for example `.st-dialog { --modal-width: 680px; }`). Do not set `width`.

## Class reference

| Class | Element | Notes |
| --- | --- | --- |
| `.modal` | `<dialog>` or `<div>`/`<section>` | The surface. A `<dialog>` is `display: flex` only while `[open]`. Also restores `pointer-events: auto`, which some containers such as `.chat-dock-wrapper` turn off. |
| `.modal-head` | `div` or `header` | Title bar. Holds one `h2`, an optional `p` subtitle, and an optional `.modal-close`. |
| `.modal-head.is-ruled` | | Adds a bottom divider. Use for long, scrolling dialogs. |
| `.modal-body` | `div` | Scrolls when content is long, so the title bar and buttons stay visible. Takes its own bottom padding when it is the last child, or when a ruled button bar follows. |
| `.modal-foot` | `div` or `footer` | Button bar, right-aligned, wraps. Primary action last. |
| `.modal-foot.is-ruled` | | Adds a top divider. Use together with a scrolling `.modal-body`. |
| `.modal-spacer` | `span` | `flex: 1`. Pushes a leading action (for example a danger button) to the left. |
| `.modal-btn` | `button` | Secondary: muted text, no background. Use for Cancel and Close. |
| `.modal-btn-primary` | `button` | Accent background. One per dialog. |
| `.modal-btn-danger` | `button` | Danger tint. Use for destructive confirmations (Delete, Remove). |
| `.modal-field` | `div` or `label` | Column with an 8px gap: label, then control. |
| `.modal-label` | `div` | Section label above a group, 14px weight 600. |
| `.modal-input` | `input`, `select`, `textarea` | Never use on checkboxes or radios. |
| `.modal-hint` | `p` | Muted helper text under a control. |
| `.modal-error` | `p` | Error text. Add `role="alert"`. |

Rules for choosing buttons:

- Cancel and Close use `.modal-btn`. Do not give them a background.
- The confirming action uses `.modal-btn-primary`. A destructive confirmation uses `.modal-btn-danger` instead, never both.
- Do not add per-dialog button styles. Keep legacy class names (`workspace-settings-save`, `is-primary`) only when a test selects them.

## Patterns

**Confirmation.** `.modal-sm`, title, one `p` in `.modal-body`, then `.modal-btn` plus `.modal-btn-danger` (or primary). Example: the recipe delete confirmation in `TaskRecipesPage`.

**Form.** Put the `<form>` directly inside the `<dialog>`; the shared CSS makes it a flex column. Use `modal-field` plus `modal-input`, then `modal-hint` or `modal-error`. Example: `RenameConversationDialog`.

**Panel with long content.** `.modal-xl` or `.modal-lg`, a scrolling `.modal-body`, and `.modal-foot.is-ruled`. Put summary text like a cost estimate on the left of the button bar with `margin-right: auto`. Examples: `RaceSetupDialog`, `HandoffPackDialog`, `MemoryDistillDialog`.

**Destructive action next to others.** Put the danger button first, then `.modal-spacer`, then Cancel and the primary button. Example: `WorkspaceSettingsDialog`.

**Dense forms.** Multi-column editors such as the scheduled task dialog may use a smaller field radius for their own controls (`var(--radius-md)`), but the surface, title bar and button bar still come from `.modal`.

## Behavior rules

- Use `showModal()` on a `<dialog>` so focus is trapped and the page behind is inert. Restore focus to the opener on close.
- `Escape` is handled in `onCancel` with `event.preventDefault()`. While a save is in flight, ignore it.
- Stop key events from reaching global shortcuts with `onKeyDown={event => event.stopPropagation()}`.
- When the dialog uses `Enter` or `Escape`, ignore them during IME composition (`event.nativeEvent.isComposing || event.keyCode === 229`).
- Click-outside: with a `<dialog>`, close on `mousedown` when `event.target === event.currentTarget`. This works only because the `<dialog>` has no padding of its own. Keep content inside the form or body. With `.sheet-backdrop`, close on the backdrop `mousedown` and stop propagation on the card.
- While busy, disable Cancel, Close and the click-outside handler.
- Every modal needs an accessible name (`aria-labelledby` pointing at the `h2`, or `aria-label`).
- New text needs `zh-CN` and `en` strings, and `zh-TW`, `ja` and `ko` under `packages/shared/src/i18n-messages/`.

## Pitfalls

- **Page-level CSS leaks into dialogs.** A `<dialog>` declared inside a page keeps the page's ancestors, so rules like `.recipe-page button` or `.recipe-page h2` match its buttons and title. Every child selector in `29-modal.css` is scoped as `.modal .modal-…` so it wins on specificity. Keep that prefix when you add rules.
- **Load order.** `29-modal.css` is imported last in `styles.css`, but feature stylesheets imported from `main.tsx` or components load after it. A feature rule with equal specificity overrides a shared one. Delete the duplicated rule instead of out-ranking it.
- **Do not restyle the shell.** Do not set `border-radius`, `box-shadow`, `background`, `::backdrop` or `width` on a feature dialog class. Change the shared file if the design should change everywhere.
- **Inline confirmations are not modals.** `.vc-dialog-actions` in the version-control panels is an inline action row inside a panel. It does not use `.modal`.

## Intentional exceptions

These are not built on `.modal` because they follow a different pattern:

| Component | Why |
| --- | --- |
| `TerminalCloseDialog` (`.terminal-close-dialog`) | A compact confirmation styled like a message-preview card, with its own tested geometry in `workbench-split-ui`. |
| `ConversationSearchDialog` (`.conversation-search-dialog`) | A command-palette style search overlay, not a titled dialog. |
| `VisualToolCard` (`.visual-modal-dialog`) | A full-size viewer for tool output. |
| `ImageViewer` | A lightbox. |

## Where each modal is built

| Modal | Component | Size |
| --- | --- | --- |
| Edit workspace | `WorkspaceSettingsDialog` | default |
| Subagent model settings | `settings/SubagentModelsPage` | default |
| Sign in (`LoginDialog`) | `ModelControls` | `modal-sm` |
| OpenAI login choice | `ProviderLoginButton` | default |
| Rename chat | `RenameConversationDialog` | `modal-sm` |
| Recipe delete and unsaved-changes | `TaskRecipesPage` (`RecipeDialog`) | `modal-sm` |
| Scheduled task editor | `ScheduledTasksPage` | 680px |
| Race setup | `RaceSetupDialog` | `modal-xl` |
| Handoff pack | `HandoffPackDialog` | `modal-xl` |
| Memory distill | `MemoryDistillDialog` | `modal-xl` |
| Recent edits across chats | `ConflictDialog` | `modal-xl` |
| PR review response | `PrInboxResponse` | `modal-lg`, `modal-xl` when wide |
| Checkpoints | `CheckpointTimelineDialog` | `modal-lg` |
| Skill details | `settings/SkillsPage` | 560px |
| Skill migration | `SkillMigrationDialog` | 640px |
| Push | `version-control/PushDialog` | `modal-sm` |
| Compare | `version-control/CompareDialog` | 1080px |

## Checking a change

```bash
pnpm --filter @vela/desktop typecheck
pnpm --filter @vela/desktop test
```

Dialog markup and class names are covered by the Electron UI checks. Run the ones for the dialogs you touched:

```bash
node apps/desktop/test/run-electron-suite.mjs ui race-ui subagent-models-settings-ui chat-actions-ui
```

`handoff-pack-ui` and `memory-distill-ui` assert the `zh-CN` locale and fail on a machine whose system language is different. They need a `zh-CN` system locale to pass.
