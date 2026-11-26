# Vela 1.3.2

Queue messages while a run is active and promote them one at a time, tailor subagents with custom profiles and naming styles, set a personalized global prompt, bring your Chrome sign-ins into the built-in browser, and run micro-apps right in the workbench. This release also refreshes onboarding, unifies workbench headers, and fixes several chat and model issues.

## New

- **Message queue.** While a run is active, sending adds the message to a queue. Each queued message shows its state and can be promoted individually with **Send now**, keeping its text, images and order. The composer keeps a single send button.
- **Custom subagent profiles.** Configure your own subagent profiles, and choose a practical (`backend`, `reviewer`) or artistic (Curie for chemistry, Turing for algorithms) naming style. Subagents show short names and their own output speed, and a conversation-scoped subagent directory lists them in the workbench.
- **Global prompt.** Add a personalized prompt in settings that applies to your desktop chats.
- **Chrome site data import.** Open the sites you need in a fresh Chrome session, or choose a Playwright `storageState` JSON file, and import the cookies and LocalStorage into the built-in browser. All its tabs share them.
- **Micro-apps in the workbench.** Sandboxed micro-apps run automatically and open in workbench tabs.
- **Built-in Vela skill.** A built-in `vela` skill answers questions about the app itself, such as where settings live and how to change colors, fonts, language and update behavior. Built-in skills appear in Settings → Skills and can be disabled but not deleted.
- **Markdown frontmatter.** File previews render Markdown frontmatter as a key/value card.

## Improved

- Onboarding follows the current settings: it drops the choices Settings no longer offers, covers run view, recommended actions, thinking summary, input prediction and the new chat start page, and mirrors the Notifications page with task sounds.
- Floating headers look the same across workbench panes, and floating info cards stay visible while dock menus are open.
- Subagent speed tiers are told apart by icon color.
- Browser REPL calls show each result separately and keep the raw output.

## Fixed

- Reopening a conversation restores the last model you sent with.
- You can type while a new chat is still initializing.

## Upgrade

Vela 1.0.6 and later downloads the update in the background and prompts you to restart. For Vela 1.0.5 and earlier, quit the app, replace it with the copy from the DMG, and reopen it. Keep your existing `~/.vela` directory or the directory set in `VELA_USER_DATA` to retain your conversations.

The macOS build uses an ad-hoc signature and is distributed without notarization. If macOS blocks the first launch, choose **Open Anyway** in System Settings → Privacy & Security. macOS may ask you to confirm privacy or keychain access again after updating.

## Download

| File | Purpose |
| --- | --- |
| `Vela-1.3.2-arm64.dmg` | macOS Apple Silicon installer |
| `Vela-1.3.2-arm64.zip` | macOS Apple Silicon application bundle used by the in-app updater |
| `SHA256SUMS.txt` | SHA-256 checksums for both downloads |
| `SHA256SUMS.txt.sig` | Ed25519 signature the updater uses to verify the checksums |

Both packages contain Vela 1.3.2.

## Validation

- The production build completed for macOS Apple Silicon. All five package and bundle version fields match 1.3.2, and the built release notes match the source in all five languages.
- The DMG mounted successfully. Its app and the app extracted from the ZIP passed strict code-signature verification. Both bundles report version 1.3.2 and the identifier `com.vela.desktop`.
- The ZIP contains a single top-level `Vela.app` with an arm64 executable.
- Both package checksums match the signed manifest. The updater's signature verifier accepted the manifest using the bundled public key.
- The automated test suites, smoke tests, and update tests were not run for this release.
