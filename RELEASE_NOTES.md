# Vela 1.3.0

Work in a borderless window with translucent sidebars, and connect more than one account per provider, including ChatGPT sign-in. This release also adds Codex response speed controls and custom reasoning levels, line comments on file previews, and shared navigation across the category pages.

## New

- **Borderless layout.** Switch to a borderless desktop layout with translucent sidebars. Choose how transparent the glass is when the window is not focused.
- **Multiple provider accounts and ChatGPT sign-in.** Add several accounts for one provider and sign in with ChatGPT to use Codex models. The Codex logo shows your remaining quota, and you can choose which Plus window it follows.
- **Codex response speed.** Choose how fast Codex models respond. A new Codex prompt is adapted to Vela's modes.
- **Custom reasoning levels.** Define the reasoning levels each custom model offers, in settings and during onboarding. Open sessions pick up the change right away.
- **File preview comments.** Add line comments to a file preview and send them to the chat as context.
- **Details in workbench tabs.** Open conversation details in a workbench tab, or open Git directly from a workspace.
- **Keep awake.** Vela can prevent idle sleep while agents are running.

## Improved

- The category pages share one resizable navigation column, so its width stays the same as you move between them.
- The chat model picker is simpler, and model length fields show their token units.
- The model settings list fades at the scroll edges. Sliding tab indicators stay in place when a tab changes size.
- Classic diff controls fit narrow panes. Syntax grammars that fail to load are retried.
- The file change summary above the composer has refined styling, and the borderless sidebars stay in sync with their opacity while collapsing.
- The unified icons setting is translated in every supported language, and the desktop preference defaults are refreshed.

## Upgrade

Vela 1.0.6 and later downloads the update in the background and prompts you to restart. For Vela 1.0.5 and earlier, quit the app, replace it with the copy from the DMG, and reopen it. Keep your existing `~/.vela` directory or the directory set in `VELA_USER_DATA` to retain your conversations.

The macOS build uses an ad-hoc signature and is distributed without notarization. If macOS blocks the first launch, choose **Open Anyway** in System Settings → Privacy & Security. macOS may ask you to confirm privacy or keychain access again after updating.

## Download

| File | Purpose |
| --- | --- |
| `Vela-1.3.0-arm64.dmg` | macOS Apple Silicon installer |
| `Vela-1.3.0-arm64.zip` | macOS Apple Silicon application bundle used by the in-app updater |
| `SHA256SUMS.txt` | SHA-256 checksums for both downloads |
| `SHA256SUMS.txt.sig` | Ed25519 signature the updater uses to verify the checksums |

Both packages contain Vela 1.3.0.

## Validation

- The production build completed for macOS Apple Silicon. All five package and bundle version fields match 1.3.0, and the built release notes match the source in all five languages.
- The DMG mounted successfully. Its app and the app extracted from the ZIP passed strict code-signature verification. Both bundles report version 1.3.0 and the identifier `com.vela.desktop`.
- The ZIP contains a single top-level `Vela.app` with an arm64 executable.
- Both package checksums match the signed manifest. The updater's signature verifier accepted the manifest using the bundled public key.
