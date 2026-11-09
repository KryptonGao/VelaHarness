# Vela Design Guide

The visual and interaction rules for the Vela desktop renderer (`apps/desktop/src/renderer`). Read this before adding or changing UI. Tokens live in `styles/01-tokens-themes.css`; base resets and focus handling live in `styles/02-base.css`.

Each rule below is either **Rule** (the intended design, which new code must follow) or **Current** (what the code does today, including known drift). Where the two differ, the gap is listed under [Known deviations](#known-deviations).

## Principles

1. **Flat and quiet.** Controls are defined by fill and shape, not by shadow or border. Elevation is reserved for surfaces that float above the page.
2. **Content first.** UI text is small and muted; conversation, code, and diffs carry the weight. Do not add secondary labels or captions that the layout already explains.
3. **One accent per theme.** A single accent color marks "do this" and "this is selected". Red means danger and nothing else.
4. **Tokens, not literals.** Colors, radii, shadows, and type sizes come from CSS variables so that every theme, light and dark, works unchanged.
5. **Pointer users see no focus chrome.** See [Focus](#focus).

## Color

### Rule

- Use only tokens from `01-tokens-themes.css`. Never write a hex or `rgb()` value in a component rule. Derive tints with `color-mix()` or the existing `--*-tint` tokens.
- Every theme block must define the full variable set; a theme cannot rely on inheriting from an outer scope (the Settings theme preview applies themes the same way).
- Verify any new UI in at least one light theme and one dark theme.

### Surfaces and text

| Token | Use |
| --- | --- |
| `--bg-chat` | Main content paper |
| `--bg-card-surface`, `--bg-elevated` | Cards, menus, inputs sitting on the paper |
| `--bg-surface-subtle` | Secondary button fill, quiet panels |
| `--bg-hover` | Hover fill for any ghost control or row |
| `--bg-code` | Code blocks, terminal, response bodies |
| `--bg-sidebar-glass` | Sidebars and top bar (frosted glass) |
| `--text-primary` / `-secondary` / `-muted` / `-dim` | Four text levels; `-dim` is for placeholders and disabled hints only |
| `--border-subtle` | The default 1px divider and card outline |
| `--border-strong` | Only where a boundary must survive on a similar fill (swatches, focused address bar) |

### Accent (blue)

`--accent-blue` is a **semantic** token, not a literal blue. Each theme overrides it (Daylight blue, Paper terracotta, Celadon teal, Lilac violet, Blossom rose, Graphite lavender, Ember orange, Forest mint, Tide cyan). Keep the historical name; never hard-code a blue.

Use the accent for:

- The one primary action in a view (send, allow, create, save).
- Selected or active state (active tab, checked control, current item), usually as `--accent-tint` fill with accent text.
- Links and hover affordances on clickable text (`color: var(--accent-blue)` on hover).
- Progress and "in flight" indicators.
- Drop targets and drag feedback.

Do not use the accent for: decoration, large background areas, headings, or more than one primary button per view. Use `--accent-contrast` for text on an accent fill. Hover on a filled accent uses `--accent-blue-hover`.

Tint tokens: `--accent-tint` (6% light / 16% dark) for resting selected backgrounds, `--accent-tint-strong` for hover on those, `--accent-border` for a quiet accent outline, `--accent-ring` for a soft halo.

### Danger (red)

`--danger` and `--danger-tint` mean exactly one family of things:

- Destructive actions: delete, discard, remove, revoke. Resting state is neutral; the button turns red on hover or once armed (`models-icon-btn.danger.armed`), and the confirming step is red.
- Errors and failed states: error cards, failed status text, invalid input messages.
- Deleted lines in diffs (`--diff-del-fg`).

Never use red for emphasis, for "attention", or for a primary action. A destructive button is not a primary button: it never gets a solid red fill at rest.

### Status colors

`--success` (done, added, connected), `--warning` (needs attention, pending approval, caution; use `--warning-strong` for text), `--violet` (agent/sub-agent and special-purpose markers). Each has a `-tint` companion. Tool kinds have their own `--tool-*` colors; use them only for tool-call chrome.

## Typography

### Typefaces

- **UI and replies:** `--font-sans`, a Latin stack (SF Pro) followed by a CJK stack, so each script picks its own best face. Serif variants for UI and replies are user options; never assume sans in layout math.
- **Monospace:** `--font-mono` (SF Mono, `ui-monospace`, Menlo). See [Monospace](#monospace).
- Sizes are always written `calc(Npx * var(--ui-scale))` for UI text and `calc(Npx * var(--code-scale))` for code, so the user's font-size settings apply. Never write a bare `px` font size.

### Scale

| Role | Size | Weight | Notes |
| --- | --- | --- | --- |
| Body, rows, buttons, menu items | 15 | 400–500 | Base size of the app |
| Secondary text, hints, metadata | 13–13.5 | 400 | `--text-secondary` or `-muted` |
| Captions, badges, timestamps | 12 | 400–500 | Smallest routine size |
| Micro labels | 11 | 500 | Counts only; avoid |
| Code (inline and blocks) | 12–14 (`--code-scale`) | 400 | Monospace |

Weights in use: 400 body, 500 reply text and emphasis, 550–560 item titles, 600 headings and buttons, 650 large headings. Do not introduce other weights.

### Page and section titles

Titles are small on purpose. Size comes from weight and position, not from scale.

| Level | Size / weight | Where | Class |
| --- | --- | --- | --- |
| Page title (top bar) | 15 / 600 | Top-left of every full page: Task Recipes, Pull Requests, Agent Inbox; same as the chat title | `.page-topbar-title`, `.chat-active-title` |
| Settings navigation title | 17 / 650 | Top of the Settings sidebar | `.settings-nav-title` |
| Settings page header | 26 / 650, tracking -0.005em | First line of a Settings content page; the only 26px text in the app | `.settings-page-header h2` |
| Dialog title | 18 / 600 | Modal and dialog headings | e.g. `.rename-conversation-dialog h2` |
| Group title | 15 / 650 | Heading above a settings card group | `.settings-group-title` |
| Row or item title | 15 / 550–600 | Title inside a card, list item, or panel | `h3` in `.settings-card`, `.mode-card-title` |
| Section label | 15 / 600, `--text-muted` | Sidebar and panel section labels | `.sidebar-section-title`, `.side-panel-heading` |

Rules:

- New full pages must put their title in the top bar with `.page-topbar-title` (15/600). Do not add a second large in-page title.
- Only Settings content pages carry an in-page header (26px). Do not copy that size elsewhere.
- One heading level jump per surface: do not stack a 26px header over an 18px dialog title over a 15px card title in the same view.
- Titles never use the accent color.

### Monospace

Use `--font-mono` for text that is **machine-shaped**, where character alignment or exact glyphs matter:

- File paths, directories, URLs, branch names, commit hashes (`.settings-path`, `.skills-dir`, `.memory-entry-path`, `.agent-path`).
- Tool names, command lines, tool output, terminal text, JSON and response bodies.
- Code blocks, inline `code`, diffs, and line numbers.
- Hex color values, IDs, and numeric counters that must not jitter (`.side-panel-counter`, `.theme-color-hex`).
- Free-form technical input such as MCP JSON config and memory file editors.

Do not use monospace for: headings, button labels, prose, descriptions, menu items, or "technical-looking" decoration. Size monospace with `--code-scale`, typically 12–14px, one step below the surrounding UI text. Numbers in prose that need steady width use `font-variant-numeric: tabular-nums` in the UI face instead.

## Shape

### Radius tokens

| Token | Value | Use |
| --- | --- | --- |
| `--radius-xs` | 6px | Small icon buttons (22–24px), tiny chips |
| `--radius-sm` | 8px | Compact buttons (28px tall), icon buttons (30px), inputs inside dense rows |
| `--radius-md` | 12px | **Standard buttons**, dropdown triggers, code blocks, inner cards, menu rows |
| `--radius-lg` | 16px | Cards and card groups |
| `--radius-xl` / `--radius-2xl` | 20 / 22px | Dock, composer, large floating panels |
| `--radius-pill` | 9999px | Badges, tags, segmented chips, the question input; never ordinary buttons |
| `50%` | circle | Avatars, status dots, the round send button and attach button |

### Buttons: rounded rectangle

**Rule:** a text button is a rounded rectangle. Standard size is `--radius-md` (12px), 32px tall, 12–14px horizontal padding. Compact size (28px tall) uses `--radius-sm`. Icon-only buttons are rounded squares (`--radius-xs` at 22–24px, `--radius-sm` at 28–32px), not circles.

- Do not make text buttons pills.
- Circles are limited to a small set of floating action controls (send, stop, attach) and avatars.
- Declare `border-radius` once per element.
- Nested rounding: an inner element's radius is the parent's radius minus the padding gap, floored at `--radius-xs`.

### Button variants

| Variant | Fill | Text | Use |
| --- | --- | --- | --- |
| Primary (accent) | `--accent-blue` | `--accent-contrast` | The single main action of a view |
| Primary (neutral) | `--text-primary` | `--bg-chat` | Main action on settings pages (`.models-add-btn`, `.models-btn.primary`) |
| Secondary | `--bg-surface-subtle` or `--bg-hover` | `--text-secondary` → `--text-primary` on hover | Everything else |
| Ghost / icon | transparent | `--text-muted` | Toolbars and row actions; `--bg-hover` on hover |
| Danger | Neutral at rest | `--danger` on hover or when armed | Destructive actions; `--danger-tint` as the fill |

States: hover changes fill or text color only (no lift, no scale beyond the `:active` press below). Disabled is `opacity: 0.4–0.5`, `cursor: default`. Press may use `transform: scale(0.97)` over 80ms. Buttons have no resting border; a bordered variant (`.models-icon-btn.bordered`) is allowed only for icon buttons that sit on a same-color card.

## Elevation and borders

### Buttons carry no shadow

**Rule:** buttons, including accent primary buttons, never have `box-shadow`. The old colored glow token (`--shadow-btn-blue`) has been removed; do not reintroduce it.

### Shadow tokens (surfaces only)

| Token | Use |
| --- | --- |
| `--shadow-card` | Cards that need a hint of lift (very soft in light themes) |
| `--shadow-dock` | The composer dock and large floating panels |
| `--shadow-popover` | Menus, popovers, tooltips, dialogs |
| `--shadow-active-item` | Selected sidebar row (dark themes only; `none` in light) |

Anything that sits in the normal flow of the page is flat. A shadow means "this floats above the page and can be dismissed".

### Borders

- Dividers and card outlines: `1px solid var(--border-subtle)`.
- The global reset removes all borders (`border: none`); add a border deliberately and only with `--border-subtle` or `--border-strong`.
- Prefer a fill change over a border to show hover, selection, or grouping.
- Inset hairlines (`box-shadow: inset 0 0 0 1px var(--border-subtle)`) are acceptable as an outline technique on non-button controls such as the settings search field.

## Focus

**Rule:** focusing a control with the pointer never draws a highlight border, ring, or glow. Text inputs, textareas, and `contenteditable` regions never draw a focus outline in any modality: the caret is the focus indicator. Do not add `border-color`, `box-shadow`, or `outline` changes on `:focus` for inputs.

**Current (accessibility exception):** `02-base.css` draws a 2px `--accent-blue` outline with 2px offset only after the user presses Tab or Shift+Tab (`focus-modality.ts` sets `data-keyboard-focus` on `<html>` and clears it on pointer down). List rows use `outline-offset: -2px` so the ring is not clipped by scroll containers. This keeps keyboard navigation usable and is the only focus chrome in the app.

Implementation notes:

- Never write `outline: none` on a control without a replacement for keyboard users; the global reset already removes outlines, so rely on `:focus-visible` plus `data-keyboard-focus`.
- Do not style `:focus` (only `:focus-visible` and `:focus-within` for behavior such as revealing row actions).
- Hover and keyboard focus should reveal the same affordances (see `.activity-row:has(:focus-visible)`).

## Layout and density

- **Spacing:** use a 2/4/6/8/10/12/14/16/20/24px set. Gaps between sibling controls are 8px; card padding is 14–18px; page content is centered with a max width (settings 740px).
- **Control height:** standard 32px, compact 28px, icon 22–30px. Hit areas are expanded to 32px with a transparent `::before` when the visual size is smaller.
- **Cards:** `--bg-elevated`, `1px solid --border-subtle`, `--radius-lg`. A group of settings is one card with rows separated by `1px` dividers, not one card per row.
- **Chrome:** the left sidebar, right panel, and top bar share one frosted-glass recipe (`--glass-blur`, `--glass-fill`, `--glass-fillet`). The content paper sits inside it with rounded corners.
- **Window drag:** controls in drag regions set `-webkit-app-region: no-drag`. Hidden but mounted panes must not leave a drag region active; use `initial`, not `none`, to restore dragging.
- **Selection:** UI text is not selectable (`user-select: none`). Content (messages, code, output, inputs) is whitelisted in `02-base.css`. Add new content classes to that whitelist.

## Motion

- Use the shared easings: `--motion-ease-enter` (`cubic-bezier(0.16, 1, 0.3, 1)`) for entrance, `--motion-ease-exit` for exit.
- Durations: 80ms press feedback, 110–120ms hover and popover exit, 180ms enter, 240ms layout transitions, 280ms sidebar.
- Motion is functional (state change, appear, disappear). No bouncing, looping, or attention-seeking animation on idle UI.
- Honor `prefers-reduced-motion: reduce` for anything beyond opacity.

## Content and copy

- Provide every new string in `zh-CN` and `en`, with `zh-TW`, `ja`, and `ko` under `packages/shared/src/i18n-messages/`; missing translations fall back to English.
- Use sentence case in English. Buttons are verbs ("Add server", "Delete"), not "OK".
- Do not repeat a title as its own description, and do not add helper text for what the control already says.
- Layout CJK and Latin text with the same line height (1.55 base); never set a fixed width that assumes Latin glyph width.

## Theming checklist for new UI

1. Only variables from the token file; no literal colors.
2. Looks correct in Daylight (light) and Midnight (dark), plus one accent-heavy theme such as Paper or Ember.
3. Accent used once per view for the primary action; red only for danger.
4. Buttons are rounded rectangles with no shadow.
5. No focus border on pointer focus or on text inputs; Tab ring still works.
6. Page title uses `.page-topbar-title`; no new title sizes.
7. Monospace only for paths, code, tool output, IDs, counters.
8. Font sizes scale with `--ui-scale` or `--code-scale`.

## Known deviations

Existing code that does not yet match the rules above. Fix when touching the area; do not copy these patterns.

| Area | Deviation | Location |
| --- | --- | --- |
| Radius literals | More than 100 raw pixel radii (`3px`, `4px`, `5px`, `6px`, `8px`, `9px`, `10px`, `11px`, `12px`) and `999px` pills beside the tokens | Across `styles/*.css` |
| Focus | Some inputs change `border-color` or `box-shadow` on `:focus` (`.browser-address`, `.explorer-search-input`) | `15-workbench.css`, `16-file-browser.css` |
| Focus | Keyboard ring still shows on Tab; the strict "no focus border" reading would remove it | `02-base.css` |
| Titles | In-page titles at 20px and 18px outside Settings, beside the 15px top-bar standard | `.workspace-settings-head h2` (20), `.tb-header h2` (20), `.app-crash h1` (20) |
| Titles | Some pages use `<span>` and one uses `<h1>` for `.page-topbar-title` | `TaskRecipesPage.tsx`, `PrInboxPage.tsx`, `AgentInboxPage.tsx` |
| Color literals | About 67 hex values outside the token file | `styles/*.css` |
| Font sizes | Half-pixel sizes (`12.5`, `13.5`, `15.5`) and a bare `font-size` without a scale variable in a few rules | `styles/*.css` |
