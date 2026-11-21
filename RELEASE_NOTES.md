# Vela 1.2.39

Expand the workbench to fill the window and keep the conversation close in a floating chat. This release also groups web search results, adds reasoning controls for subagent models, and shows remaining Codex quota in the navigation rail.

## New

- **Fullscreen workbench.** Open a workbench tab full screen and keep chatting in a floating window. Drag the chat by its header, adjust its height, or hide it. Select the Chat tab to return to the full conversation.
- **Web search results.** Consecutive searches share one expandable row. Select a page title to open it in the browser panel. The trace keeps the individual search and fetch calls.
- **Subagent reasoning effort.** Choose which reasoning levels a subagent may use with each model. When a subagent inherits a level, it uses the closest allowed setting.
- **Codex quota ring.** The ring above Settings in the navigation rail shows your remaining quota. In interface settings, you can adjust the low-quota threshold or hide the ring.

## Improved

- Floating environment cards leave room for chat content. Resident Agent chats keep the latest message in view as the composer changes height.
- Conflict warnings stay with the turn that triggered them. The file change summary above the composer can now be toggled in settings.
- The default window size is 1280 × 800. Chat controls label agent mode as **Build**.
- Scheduled tasks keep the date, weekday, and time zone in the prompt so its prefix can be cached across turns on the same day. The scheduling tool still provides the exact time when needed.

## Upgrade

Vela 1.0.6 and later downloads the update in the background and prompts you to restart. For Vela 1.0.5 and earlier, quit the app, replace it with the copy from the DMG, and reopen it. Keep your existing `~/.vela` directory or the directory set in `VELA_USER_DATA` to retain your conversations.

The macOS build uses an ad-hoc signature and is distributed without notarization. If macOS blocks the first launch, choose **Open Anyway** in System Settings → Privacy & Security. macOS may ask you to confirm privacy or keychain access again after updating.

## Download

| File | Purpose |
| --- | --- |
| `Vela-1.2.39-arm64.dmg` | macOS Apple Silicon installer |
| `Vela-1.2.39-arm64.zip` | macOS Apple Silicon application bundle used by the in-app updater |
| `SHA256SUMS.txt` | SHA-256 checksums for both downloads |
| `SHA256SUMS.txt.sig` | Ed25519 signature the updater uses to verify the checksums |

Both packages contain Vela 1.2.39.

## Validation

- The production build completed for macOS Apple Silicon. All five package and bundle version fields match 1.2.39, and the built release notes match the source in all five languages.
- The DMG mounted successfully. Its app and the app extracted from the ZIP passed strict code-signature verification. Both bundles report version 1.2.39 and the identifier `com.vela.desktop`.
- The ZIP contains a single top-level `Vela.app` with an arm64 executable.
- Both package checksums match the signed manifest. The updater's signature verifier accepted the manifest using the bundled public key.
