# Vela 1.3.3

See the result of every action in window toasts, pick up your workbench tabs and layout where you left off, keep the chat title and actions pinned in the fullscreen workbench, and reset hidden settings in one click. This release also simplifies chat information cards and file previews, and fixes several layout and localization issues.

## New

- **Action feedback in window toasts.** Chat actions, Git, pull request and workspace actions, settings and onboarding changes, and agent inbox, resident and recipe actions now report their result in a window toast. Archiving a conversation offers an **Undo**.
- **Workbench restored across sessions.** Reopening a conversation brings back its workbench tabs and layout.
- **Animated workbench tabs.** Tabs open, close and reorder with motion without shifting a tab strip that already fits, and the new tab button stays beside the last tab.
- **Fullscreen workbench header.** The chat title and actions stay pinned in the fullscreen workbench, with a view transition when entering and leaving it.
- **Reset hidden settings.** Interface settings can reset the hidden desktop settings to their defaults.
- **Per-agent diff line counts.** The subagent card shows the lines each agent added and removed.

## Improved

- Chat information cards are simpler, and the Environment card is hidden by default.
- File preview toolbars show fewer actions.
- The main and subagent chat composers share the same margins, and the live run status and change summaries stay aligned with the composer.
- Floating info cards stay stationary while the workbench opens and closes.
- Tool summary hover emphasis applies to individual text segments, and numerals in bold Markdown replies use a lighter weight.
- Hidden desktop settings and their defaults are documented.

## Fixed

- Desktop greetings, counts and validation messages follow the interface language.
- The new tab button no longer drifts away from the last workbench tab.

## Upgrade

Vela 1.0.6 and later downloads the update in the background and prompts you to restart. For Vela 1.0.5 and earlier, quit the app, replace it with the copy from the DMG, and reopen it. Keep your existing `~/.vela` directory or the directory set in `VELA_USER_DATA` to retain your conversations.

The macOS build uses an ad-hoc signature and is distributed without notarization. If macOS blocks the first launch, choose **Open Anyway** in System Settings → Privacy & Security. macOS may ask you to confirm privacy or keychain access again after updating.

## Download

| File | Purpose |
| --- | --- |
| `Vela-1.3.3-arm64.dmg` | macOS Apple Silicon installer |
| `Vela-1.3.3-arm64.zip` | macOS Apple Silicon application bundle used by the in-app updater |
| `SHA256SUMS.txt` | SHA-256 checksums for both downloads |
| `SHA256SUMS.txt.sig` | Ed25519 signature the updater uses to verify the checksums |

Both packages contain Vela 1.3.3.

## Validation

- The production build completed for macOS Apple Silicon. All five package and bundle version fields match 1.3.3, and the in-app release notes carry version 1.3.3 in all five languages.
- The app was ad-hoc re-signed and both packages were rebuilt from it. The app extracted from the ZIP and the app inside the mounted DMG passed strict code-signature verification. Both bundles report version 1.3.3 and the identifier `com.vela.desktop`.
- The ZIP contains a single top-level `Vela.app` with an arm64 executable.
- Both package checksums match the signed manifest. The updater's signature verifier accepted the manifest using the bundled public key.
- The automated test suites, smoke tests, and update tests were not run for this release.
