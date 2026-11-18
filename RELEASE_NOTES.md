# Vela 1.2.37

Vela 1.2.37 adds an opt-in picker that combines the model and reasoning effort into one composer button, keeps unsent composer drafts per conversation, and makes reply actions icon-only.

## New

- **Combined model and reasoning effort picker**: turn on **Combine model and reasoning effort** under Settings → Interface to adjust reasoning effort with a slider and switch models from one composer button. It is off by default and fits narrow workbench panes.
- **Per-conversation drafts**: unsent composer text is kept for each conversation and restored when you switch back. New chats share one draft, and a draft is cleared as soon as it is sent. Drafts live in memory only and do not survive a restart.
- **Acceptance icon**: outcome acceptance has its own icon in reply actions, the acceptance panel, and workbench tabs, in both the classic and unified icon sets.

## Improved

- **Icon-only reply actions**: copy, read aloud, branch, checkpoint, memory, and acceptance actions under replies are compact icons with tooltips and accessible labels.
- **Read-aloud states**: the read-aloud button shows a clock while preparing, a stop icon while playing, and a warning icon on failure.
- **Picker model switching**: switching models in the combined picker keeps the model list and the reasoning slider in sync.

## Upgrade

Installed copies of Vela 1.0.6 and later receive this update automatically: Vela downloads it in the background and prompts you to restart. Versions 1.0.5 and earlier cannot update themselves, so install this version manually once: quit Vela completely, replace the application with this version, and reopen it.

Keep your existing `~/.vela` directory (or the directory specified by `VELA_USER_DATA`); no data reset is needed. Existing conversations open as before.

The macOS build is not notarized and uses an ad-hoc signature. If macOS blocks first launch, use **Open Anyway** in System Settings → Privacy & Security. Because the code signature differs between versions, macOS may ask you to confirm privacy or keychain access again after an update.

## Download

| File | Platform |
| --- | --- |
| `Vela-1.2.37-arm64.dmg` | macOS Apple Silicon installer |
| `Vela-1.2.37-arm64.zip` | macOS Apple Silicon application bundle (`.app`); also the package used by in-app updates |
| `SHA256SUMS.txt` | SHA-256 checksums for both packages |
| `SHA256SUMS.txt.sig` | Ed25519 signature of `SHA256SUMS.txt`, verified by the in-app updater |

Package version: `1.2.37`. macOS bundle and download version: `1.2.37`.

## Validation

- Release metadata verified: all package and macOS bundle version fields are `1.2.37`; all five in-app release-note languages contain four highlights and five improvements.
- Production build and macOS arm64 packaging completed, followed by ad-hoc signing of `Vela.app` and regeneration of the DMG and ZIP from the signed bundle.
- The app extracted from the ZIP and the app in the mounted DMG passed strict code-signature verification and bundle version checks; the bundle identifier is `com.vela.desktop`. The packaged app contains the final in-app release notes (`1.2.37`).
- The ZIP has a single top-level `Vela.app` and passed archive-integrity verification. The DMG passed checksum verification and mounted successfully.
- `SHA256SUMS.txt` was generated and signed with the release key, whose public key is bundled in the app.

The automated test suites were not run for this release, as requested.
