# Vela 1.2.38

Vela 1.2.38 adds selectable start pages for new chats, shows live file changes and per-turn quota usage near the composer, and makes Resident Agent follow-ups and subagent chats more reliable.

## New

- **Start page styles**: choose how an empty chat looks under Settings → Interface → Start page style. **Atelier** is the new default, a left-aligned editorial desk with a workspace masthead, mode rail, and tabbed starter index; **Command Deck** shows live repository changes or recent commits with a ⌘1–⌘4 shortcut matrix; **Classic** keeps the centered greeting and prompt cards; **Minimal** shows only the composer. Installations that had Minimal start page turned on stay on Minimal.
- **Live file changes above the composer**: files changed during the current turn appear above the chat composer while the agent works.
- **Resident Agent follow-ups**: Resident Agent tasks support follow-ups and event-driven replies, and composer messages in a Resident Agent view go through the agent conversation.
- **Per-turn quota usage**: the 5h and 1w quota consumed by a turn appears in a small capsule next to the elapsed time, rounded to whole percent and shown as <1% below one percent.

## Improved

- **Turn changes**: file icons and emphasized filenames, a compact-diff toggle on line counts, and a changes review file tree that can be toggled at any width.
- **Composer usage metrics**: usage figures sit side by side in the composer.
- **Settings sidebar**: the settings sidebar can be resized in navigation rail mode.
- **Subagent chats**: background results are batched and each message identifies its sender; cumulative chat tokens now include subagent usage.
- **Responsiveness**: switching conversation modes stays responsive and consistent, previously rendered entries no longer replay arrival animations, and the startup model hint is no longer rewritten for unchanged snapshots.
- **Localization**: new start page and usage copy is available in all five languages.

## Upgrade

Installed copies of Vela 1.0.6 and later receive this update automatically: Vela downloads it in the background and prompts you to restart. Versions 1.0.5 and earlier cannot update themselves, so install this version manually once: quit Vela completely, replace the application with this version, and reopen it.

Keep your existing `~/.vela` directory (or the directory specified by `VELA_USER_DATA`); no data reset is needed. Existing conversations open as before.

The macOS build is not notarized and uses an ad-hoc signature. If macOS blocks first launch, use **Open Anyway** in System Settings → Privacy & Security. Because the code signature differs between versions, macOS may ask you to confirm privacy or keychain access again after an update.

## Download

| File | Platform |
| --- | --- |
| `Vela-1.2.38-arm64.dmg` | macOS Apple Silicon installer |
| `Vela-1.2.38-arm64.zip` | macOS Apple Silicon application bundle (`.app`); also the package used by in-app updates |
| `SHA256SUMS.txt` | SHA-256 checksums for both packages |
| `SHA256SUMS.txt.sig` | Ed25519 signature of `SHA256SUMS.txt`, verified by the in-app updater |

Package version: `1.2.38`. macOS bundle and download version: `1.2.38`.

## Validation

- Release metadata verified: all package and macOS bundle version fields are `1.2.38`; all five in-app release-note languages contain four highlights and five improvements.
- Production build and macOS arm64 packaging completed, followed by ad-hoc signing of `Vela.app` and regeneration of the DMG and ZIP from the signed bundle.
- The app extracted from the ZIP and the app in the mounted DMG passed strict code-signature verification and bundle version checks; the bundle identifier is `com.vela.desktop`.
- The ZIP has a single top-level `Vela.app` and passed archive-integrity verification. The DMG passed checksum verification and mounted successfully.
- `SHA256SUMS.txt` was generated and signed with the release key, whose public key is bundled in the app.

The automated test suites were not run for this release, as requested.
