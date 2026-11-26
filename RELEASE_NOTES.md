# Vela 1.3.1

Inspect what subagents did, track Codex usage alongside your other providers, preview workspace HTML in the workbench, and get notifications only for conversations you are not looking at. This release also streamlines the composer and settings, and fixes several background-request and prompt issues.

## New

- **Subagent traces.** Open a subagent to see its tool activity. Subagents can optionally use the faster Codex speed, Vela remembers your Codex speed choice, and the subagent model pool shows a description for each model.
- **Codex usage.** Usage now includes your local Codex desktop activity, indexed in a background worker, with provider filters and tiered pricing. Hover the activity heatmap to see the tokens used on each day.
- **Workspace HTML preview.** Preview a workspace HTML file in the workbench together with its local scripts, styles and images.
- **Notification settings.** A new Notifications page in settings holds the system notification options, including completion alerts, hidden previews and quiet hours. The Resident settings share the same options.
- **Turn summaries.** The file change summary shows only what changed in the current turn, and the subagent header floats above the conversation.
- **Hold to quit.** On macOS, hold Command-Q to quit so an accidental press no longer closes the app.

## Improved

- System alerts are silenced only for conversations the focused window actually shows, including split chat panes and workbench chats, instead of whenever the app is in front.
- Chat input uses the capsule composer everywhere. Sidebar and history controls sit in the window titlebar, and settings groups are separated by simple dividers. The Tab key badge on input predictions is gone.
- Workbench tabs sort more sensibly and keep composer drafts. Version control opens from the borderless chat header, and the borderless navigation rail matches the adjacent list.
- Race is now an opt-in experimental feature.
- Clipped desktop text fades out instead of ending in an ellipsis, floating info cards animate together with the chat column, and compact tool output has more space above it.
- Auxiliary requests, such as title generation, no longer disturb chat sessions. Prompt sections stay stable so task dates are added only when they change.
- Side chats pick their model and thinking level correctly, generated conversation titles stay short, and intelligent UI charts have better proportions and labels.
- Agents are guided to report progress at meaningful milestones.

## Upgrade

Vela 1.0.6 and later downloads the update in the background and prompts you to restart. For Vela 1.0.5 and earlier, quit the app, replace it with the copy from the DMG, and reopen it. Keep your existing `~/.vela` directory or the directory set in `VELA_USER_DATA` to retain your conversations.

The macOS build uses an ad-hoc signature and is distributed without notarization. If macOS blocks the first launch, choose **Open Anyway** in System Settings → Privacy & Security. macOS may ask you to confirm privacy or keychain access again after updating.

## Download

| File | Purpose |
| --- | --- |
| `Vela-1.3.1-arm64.dmg` | macOS Apple Silicon installer |
| `Vela-1.3.1-arm64.zip` | macOS Apple Silicon application bundle used by the in-app updater |
| `SHA256SUMS.txt` | SHA-256 checksums for both downloads |
| `SHA256SUMS.txt.sig` | Ed25519 signature the updater uses to verify the checksums |

Both packages contain Vela 1.3.1.

## Validation

- The production build completed for macOS Apple Silicon. All five package and bundle version fields match 1.3.1, and the built release notes match the source in all five languages.
- The DMG mounted successfully. Its app and the app extracted from the ZIP passed strict code-signature verification. Both bundles report version 1.3.1 and the identifier `com.vela.desktop`.
- The ZIP contains a single top-level `Vela.app` with an arm64 executable.
- Both package checksums match the signed manifest. The updater's signature verifier accepted the manifest using the bundled public key.
- The automated test suites, smoke tests, and update tests were not run for this release.
