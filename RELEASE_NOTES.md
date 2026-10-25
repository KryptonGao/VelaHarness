# Vela 1.2.1

Vela 1.2.1 is a usability and accessibility release. It fixes several cases where typed text, attachments or an answer could be lost, makes approvals and questions reachable from the keyboard and screen readers, adds `/model`, `/compact` and `/status` commands to the composer, redesigns the Skills settings page, and lets you limit how many sub-agents a conversation can create.

## New

- **Composer commands**: Type `/` to run `/model` (open the model and reasoning-effort picker), `/compact` (compact the context, with progress and a before/after token count) and `/status` (show the model, mode and context usage). Commands appear next to your skills and only when they apply.
- **Sub-agent limits**: The usage-limit settings (including the conversation's Limit settings tab) now have a sub-agent limit (0 to 64 across all levels of a conversation; 0 disables sub-agents) and a switch for whether sub-agents may create their own sub-agents. These apply even when the time and token limits are off.
- **Skills page**: Search, filter by All, Enabled or Disabled, refresh the list, and open a detail view with the description, scope, status and file path (with Copy path). Skill load errors and warnings are summarized at the top.

## Fixed

- Pressing Enter in an empty composer no longer sends the predicted message you never confirmed. Tab or Enter now only fills the prediction into the input so you can read and edit it, and Enter sends it from there. The prediction is also announced to screen readers.
- If sending fails, your text and attachments are restored instead of being cleared. A newer draft you have already started is never overwritten.
- Question cards no longer get stuck on "waiting for confirmation" after a failed reply: the options come back and the error is shown.
- Attachments that are dropped (more than 12 files or 6 pasted images) or that cannot be read or decoded now show an "Ignored N files" notice instead of disappearing silently.
- A history reply with no process and no recorded duration no longer shows a "Duration unavailable" divider.
- The composer input grows to the height set by your font size and window instead of stopping at a fixed 140px.
- A hard-coded Chinese error ("Unable to read skills") is now translated, and user message times use your language and region.

## Improved

- **Approvals and questions**: When the agent is waiting for your decision, focus moves to the safer control (Deny) unless you are in the middle of typing, and returns to where it was afterwards. Question cards announce themselves to screen readers.
- **View tabs**: The Conversation, Trace, Version Control, Usage, Context and Limit settings tabs support Left and Right arrows, Home and End (Enter or Space selects), and are linked to their panels. A disabled tab's reason is read aloud, not just shown as a tooltip. When the tabs are cut off in a narrow window, a fade at the edge shows they scroll. The Limits tab is renamed "Limit settings" to tell it apart from Usage.
- **Conversation log**: The message area is a polite live region, marked busy while a reply streams, so streamed replies, finished tools and errors are announced. The per-second timer is excluded.
- **Clearer destructive actions**: The "Revert" button on a turn is now "Revert in Changes…" with a tooltip saying it opens Workspace Changes rather than reverting directly. Editing a message now shows a warning that resending withdraws later content and file changes, with the shortcut for sending.
- Queue and steer shortcuts are shown next to the send button while a task is running.
- Larger click targets for message action buttons, disabled controls are easier to see, and Copy and Branch to new chat no longer wrap one character per line in narrow columns.
- Sub-agent streams can group tool calls across consecutive messages, matching the main conversation.
- Japanese, Korean and Traditional Chinese translations for the new text are included.

## Upgrade

Installed copies of Vela 1.0.6 and later receive this update automatically: Vela downloads it in the background and prompts you to restart. Versions 1.0.5 and earlier cannot update themselves, so install this version manually once: quit Vela completely, replace the application with this version, and reopen it.

Keep your existing `~/.vela` directory (or the directory specified by `VELA_USER_DATA`); no data reset is needed.

The macOS build is not notarized and uses an ad-hoc signature. If macOS blocks first launch, use **Open Anyway** in System Settings → Privacy & Security. Because the code signature differs between versions, macOS may ask you to confirm privacy or keychain access again after an update.

## Download

| File | Platform |
| --- | --- |
| `Vela-1.2.1-arm64.dmg` | macOS Apple Silicon installer |
| `Vela-1.2.1-arm64.zip` | macOS Apple Silicon application bundle (`.app`); also the package used by in-app updates |
| `SHA256SUMS.txt` | SHA-256 checksums for both packages |
| `SHA256SUMS.txt.sig` | Ed25519 signature of `SHA256SUMS.txt`, verified by the in-app updater |

Package version: `1.2.1`. macOS bundle and download version: `1.2.1`.

## Validation

- Type checks passed, and unit tests passed in the workspace (191), agent (707 passed, one skipped) and desktop (975) packages.
- All 29 in-app update tests passed (`pnpm --filter @vela/desktop test:updates`).
- The production build passed (`pnpm build`).
- Eleven of fourteen real-Electron smoke suites passed in the full run. Task Recipes and PR Inbox failed with the same symptoms already documented in earlier releases (Task Recipes: `Missing button 编辑`); these failures remain unresolved. Scheduled Tasks timed out at startup in the full run while the machine was low on memory, and passed twice when run on its own.
