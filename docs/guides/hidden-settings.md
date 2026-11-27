# Hidden desktop settings

Vela 1.3.1 simplified the Appearance, Interface, and Conversation display pages. The preferences below still work even though they no longer appear in Settings or its search results. Most are only editable in `ui-state.json`; the Version Control layout also has a selector on the Version Control page. Two former composer preferences were removed entirely and are listed separately.

## Reset hidden settings in Vela

In **Settings → Interface → Hidden settings**, select **Reset** to restore the defaults below without restarting Vela. To reverse the reset, choose **Undo** in the notification. If nothing differs from the defaults, Vela makes no changes.

The reset also clears non-default values left by the two removed composer controls. It does not clear conversations, drafts, thinking summaries, or Intelligent UI metrics. For the quota ring, it resets only `showCodexLogo` and `threshold`, not the visible enable switch or quota window.

## Edit `ui-state.json`

| Profile | File |
| --- | --- |
| Installed build | `~/.vela/ui-state.json` |
| Source development build | `~/.vela-dev/ui-state.json` |
| Custom data directory | `<VELA_USER_DATA>/ui-state.json`, if set when launching Vela |

1. Let active work finish, then choose **Vela → Quit Vela**. Closing the window is not enough. Vela reads these settings on startup and can overwrite edits made while it is running.
2. Make a backup of `ui-state.json`. Open the original in a text editor. If it does not exist, start with `{}`.
3. Add or replace only the entries you want to change. Preserve the other entries: the file also stores UI state and completed thinking summaries.
4. Save valid JSON (no comments, duplicate keys, or trailing commas) and reopen Vela. If the change does not work, check the profile path, the value's quoting, and any conditions in the tables below.

The file is a flat JSON object with `vela.` keys. **Every top-level value must be a string or JSON `null`.** For example, use `"false"` and `"42"`, not bare `false` and `42`. Some settings parse a second layer of JSON: copy the escaped quotes exactly for layout options such as `"\"classic\""`. A bare boolean, number, or object at the top level makes the entire file unreadable to Vela.

This example switches to Classic navigation, adjusts the glass tint opacity, disables the combined model picker, and shows directories on file rows. Merge only the entries you want into your file; do not replace the file with this example.

```json
{
  "vela.navLayout": "\"classic\"",
  "vela.glassOpacity": "42",
  "vela.combinedModelPicker": "false",
  "vela.filePath": "true"
}
```

**Reset one preference:** quit Vela and set that entry to bare `null` (not `"null"`). This uses the built-in fallback without importing any older value from Electron's local storage. For a setting within `vela.usageRing`, remove only that field from the encoded object to keep the other quota preferences. To undo your edits, quit Vela and restore the backup. Do not delete the entire file to reset one setting.

## Appearance

The values in the tables are written exactly as they belong on the right-hand side of a JSON entry. Defaults apply when no preference is saved, not when upgrading with a valid saved choice.

| Key | Values | Default | Effect |
| --- | --- | --- | --- |
| `vela.glassTint` | `"theme"`, `"neutral"`, `"none"` | `"neutral"` | Tint translucent edges with the theme color, with white in light mode and black in dark mode, or with no tint. In dark mode, `"none"` still uses black tint. |
| `vela.glassOpacity` | Integer string `"0"`–`"100"`, or `null` for automatic | Automatic: 55% in light mode and 85% in dark mode with `"theme"`; 15% for white or black neutral tint | Opacity of the tint while focused, not the blur strength. No effect with `"none"` in light mode because there is no tint layer. |
| `vela.unfocusedGlassMode` | `"opaque"`, `"unchanged"`, `"relative"`, `"absolute"` | `"absolute"` | On loss of focus, use a solid fill, keep the focused opacity, increase it by a relative percentage, or add percentage points. |
| `vela.unfocusedGlassIncrease` | Integer string `"0"`–`"100"` | `"40"` | Only used in `"relative"` and `"absolute"`. For example, 50% focused opacity with `"40"` becomes 70% in relative mode or 90% in absolute mode. The result is capped at 100%. |
| `vela.sidebarCardGlass` | `"true"`, `"false"` | `"true"` | Make the sidebar card in Categories navigation translucent rather than solid. |
| `vela.unifiedIcons` | `"true"`, `"false"` | `"false"` | Use MingCute instead of the classic interface glyphs. This does not change the file icon theme. |

## Interface

| Key | Values | Default | Effect |
| --- | --- | --- | --- |
| `vela.navLayout` | `"\"classic\""`, `"\"rail\""` | `"\"rail\""` | Classic uses a sidebar only; Categories (`rail`) adds a separate navigation rail on the left. |
| `vela.versionControlLayout` | `"\"classic\""`, `"\"review\""` | `"\"classic\""` | Review places the file list and commit editor in one rail to leave more room for diffs. Also selectable on the Version Control page. |
| `vela.conversationWorkbenchTabs` | `"true"`, `"false"` | `"true"` | Use the right-hand workbench tabs for conversation views. Turning this off restores the legacy layout for those views and also disables the borderless interface. |
| `vela.borderlessInterface` | `"true"`, `"false"` | `"true"` | Use the borderless window layout. Has no effect unless `vela.conversationWorkbenchTabs` is `"true"`. |
| `vela.previewBreadcrumbMode` | `"\"scroll\""`, `"\"hover\""` | `"\"scroll\""` | Scroll the full file-preview path, or compress it and expand individual segments on hover. |
| `vela.combinedModePicker` | `"true"`, `"false"` | `"true"` | Use one menu for chat mode and execution permissions, or show separate controls. This changes the controls, not the permissions themselves. |
| `vela.combinedModelPicker` | `"true"`, `"false"` | `"true"` | Use one control for model and reasoning effort, or show separate controls. |
| `vela.composerCapsules` | `"true"`, `"false"` | `"false"` | Add pill-shaped backgrounds to composer controls such as Attach and Model. This does not change the composer layout. |

### Codex quota ring

`vela.usageRing` holds a JSON object **encoded as a string**. Edit its fields inside that string; do not add top-level `vela.usageRing.threshold` or `vela.usageRing.showCodexLogo` entries. The ring is visible in Categories navigation only when it is enabled and Codex quota data is available.

| Field inside `vela.usageRing` | Values in the inner JSON | Default | Effect |
| --- | --- | --- | --- |
| `showCodexLogo` | `true`, `false` | `true` | Use the Codex logo outline or a plain circle. |
| `threshold` | Number from `0` to `100` | `10` | Turn the ring yellow when the remaining percentage is strictly below this threshold. The value is rounded to an integer. |

This example selects a plain circle and a 20% threshold. If you already have `enabled` or `plusWindow` in the same entry, keep their existing values. Those two fields can still be changed in Settings → Interface.

```json
{
  "vela.usageRing": "{\"showCodexLogo\":false,\"threshold\":20}"
}
```

## Conversation display

### Tool calls and changes

| Key | Values | Default | Effect |
| --- | --- | --- | --- |
| `vela.toolDisplay` | `"card"`, `"compact"` | `"compact"` | Expandable tool cards or compact rows. |
| `vela.toolFold` | `"message"`, `"position"`, `"none"` | `"none"` | Group consecutive calls within one assistant message, also group across adjacent messages, or do not group. Thinking, visible text, user messages, and interactive cards still break groups. |
| `vela.toolIconColor` | `"color"`, `"theme"`, `"gray"` | `"gray"` | Color compact tool icons by tool type, use the theme accent, or use gray. Old `"true"` and `"false"` values map to `"color"` and `"gray"`. |
| `vela.toolProcessDetails` | `"true"`, `"false"` | `"false"` | Show recorded per-call and per-turn durations in compact mode and remember which rows are expanded. Old calls without timing data have no duration label. |
| `vela.showChangeSummary` | `"true"`, `"false"` | `"true"` | Show changed file and added/removed line counts above the composer when the turn has changes to review. |
| `vela.minimalMode` | `"true"`, `"false"` | `"false"` | In compact mode only, hide file icons and directories and use dashed underlines on filenames. |
| `vela.filePath` | `"true"`, `"false"` | `"false"` | Show the directory on read, edit, and create file rows. Compact minimal mode hides directories even when this is on. |

### Thinking and streaming

| Key | Values | Default | Effect |
| --- | --- | --- | --- |
| `vela.thinkingSummaryStyle` | `"inline"`, `"headline"`, `"prose"` | `"prose"` | Place an available summary after the Thinking label, use it as the heading, or style it like reply text. This does not enable summary generation. |
| `vela.thinkingGroupMode` | `"single"`, `"coherent"`, `"codex"`, `"codex-modern"` | `"codex"` | Choose how supported reasoning summaries and tool calls are grouped. See the mode descriptions below. |
| `vela.thinkingActivityDelayEnabled` | `"true"`, `"false"` | `"true"` | Delay the tool-action headline so brief operations do not replace the thinking summary. Off shows the action immediately and preserves the saved delay. |
| `vela.thinkingActivityDelayMs` | Integer string `"100"`–`"5000"` | `"500"` | Minimum operation duration in milliseconds before the tool-action headline appears, when the delay is enabled. |
| `vela.thinkingTitleStyle` | `"bold-dark"`, `"bold-muted"`, `"normal-dark"`, `"normal-muted"` | `"normal-muted"` | Choose the weight and color of supported thinking headings. `dark` uses the theme's primary text color, not a hardcoded black. |
| `vela.thinkingGroupHeight` | Integer string `"160"`–`"640"` | `"280"` | Maximum expanded group height in pixels. |
| `vela.commandDetailHeight` | Integer string `"120"`–`"400"` | Uses the saved `vela.toolDetailHeight` if present; otherwise `"240"` | Maximum command-output detail height in pixels. |
| `vela.toolDetailHeight` | Integer string `"120"`–`"400"` | `"240"` | Maximum edit detail height in pixels. |
| `vela.toolDetailHeightScale` | `"true"`, `"false"` | `"true"` | Scale detail heights down when the actual group height is below its limit. |
| `vela.thinkingGroupHeightGrow` | `"true"`, `"false"` | `"true"` | Let a group grow up to its height limit when details expand. Takes precedence over proportional scaling. |
| `vela.replyFade`, `vela.thinkingFade` | `"true"`, `"false"` | `"true"` for each | Fade in streaming reply text or thinking text, respectively. |
| `vela.replyPop`, `vela.thinkingPop` | `"true"`, `"false"` | `"false"` for each | Add a pop animation to streaming reply text or thinking text, respectively. |

- `single` uses one group per supported reasoning summary. `coherent` groups thinking and tools between visible reply segments while retaining the individual summaries.
- `codex` groups like `coherent`, but hides the individual summaries in the expanded group. `codex-modern` adds nested guide lines and lets the group grow with its contents: group height, proportional scaling, and grow-with-details settings have no effect in that mode. Command and edit detail limits still apply.

### Intelligent UI diagnostics

Set `"vela.ui.inspector": "1"` to show the developer inspector below a rendered `vela-ui` block in an installed build. Use `null` to reset it. The inspector is always visible in the development renderer (`import.meta.env.DEV`). This does not change whether Vela generates interactive UI or runs micro-apps; those settings remain in Conversation display.

The aggregate metrics panel and its reset button were removed from Settings. Local aggregate counters are still stored under `vela.ui.metrics`. To clear those counters, set the entry to `null` while Vela is fully quit. This does not reset saved inputs on individual interactive cards.

## Removed preferences

| Old key | Current behavior |
| --- | --- |
| `vela.composerLayout` | The app uses the capsule composer regardless of old `classic`, `calm`, or `capsule` values. |
| `vela.sendButtonIcon` | The main composer uses an upward arrow; the old paper-plane value no longer changes it. |

## Implementation references

- [Desktop profile resolution](../../apps/desktop/src/main/vela-home.ts) (`resolveVelaHome`) and [file format validation](../../apps/desktop/src/main/ui-storage.ts) (`UiStorage`).
- [Renderer storage and legacy migration](../../apps/desktop/src/renderer/ui-storage.ts) (`createUiStorage`) and [appearance and display defaults](../../apps/desktop/src/renderer/hooks/usePreferences.ts) (`usePreferences`).
- [Quota ring parsing](../../apps/desktop/src/renderer/hooks/useUsageRingPrefs.ts) (`normalizeUsageRingPrefs`) and [Intelligent UI diagnostics](../../apps/desktop/src/renderer/components/intelligent-ui/ui-metrics-instance.ts) (`useUiInspectorEnabled`).
