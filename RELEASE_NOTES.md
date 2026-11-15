# Vela 1.2.36

Vela 1.2.36 lets approval choices be remembered per project, adds built-in slash commands and custom commands, and brings voice to the composer with read-aloud for replies and voice input. It also adds a turn navigation rail for long sessions.

## New

- **Remembered approvals**: the approval card now offers Allow once, Always allow, Deny, and Always deny, and appears as a separate card above the composer. Choices are remembered per project in `project-permissions.json` next to `vela-settings.json`, outside the repository.
- **Approval records**: a new settings page lists the remembered Always allow and Always deny choices for each project and lets you delete them.
- **Slash commands**: built-in `/effort`, `/mode`, `/handoff`, `/race`, and `/review` commands, plus your own custom commands defined as Markdown files in `.vela/commands/*.md`.
- **Read-aloud**: final replies can be read aloud with DeepSeek text-to-speech, and you can choose between the Stella and Tide voices. The option appears only when a DeepSeek API key is configured.
- **Voice input**: dictate into the composer with DeepSeek speech recognition; DeepSeek-Flash cleans up the transcript. It appears only when an API key is configured.
- **Turn navigation rail**: sessions with several turns show a left navigation rail on hover for jumping between turns.

## Improved

- **Deny wins**: a remembered Always deny applies in every mode and takes precedence over a remembered Always allow.
- **Conservative Always allow**: Always allow is offered only for a short list of read-only and build commands, and Always deny names the program, or the program and verb, it will block.
- **Test stability**: the MCP runtime test timeout now applies per test, and the incremental tokenizer test has a higher time limit, so slow CI runners no longer fail them.

## Upgrade

Installed copies of Vela 1.0.6 and later receive this update automatically: Vela downloads it in the background and prompts you to restart. Versions 1.0.5 and earlier cannot update themselves, so install this version manually once: quit Vela completely, replace the application with this version, and reopen it.

Keep your existing `~/.vela` directory (or the directory specified by `VELA_USER_DATA`); no data reset is needed. Existing conversations open as before.

The macOS build is not notarized and uses an ad-hoc signature. If macOS blocks first launch, use **Open Anyway** in System Settings → Privacy & Security. Because the code signature differs between versions, macOS may ask you to confirm privacy or keychain access again after an update.

## Download

| File | Platform |
| --- | --- |
| `Vela-1.2.36-arm64.dmg` | macOS Apple Silicon installer |
| `Vela-1.2.36-arm64.zip` | macOS Apple Silicon application bundle (`.app`); also the package used by in-app updates |
| `SHA256SUMS.txt` | SHA-256 checksums for both packages |
| `SHA256SUMS.txt.sig` | Ed25519 signature of `SHA256SUMS.txt`, verified by the in-app updater |

Package version: `1.2.36`. macOS bundle and download version: `1.2.36`.

## Validation

- Release metadata verified: all package and macOS bundle version fields are `1.2.36`; all five in-app release-note languages contain four highlights and five improvements.
- Production build and macOS arm64 packaging completed, followed by ad-hoc signing of `Vela.app` and regeneration of the DMG and ZIP from the signed bundle.
- The app extracted from the ZIP and the app in the mounted DMG passed strict code-signature verification and bundle version checks; the bundle identifier is `com.vela.desktop`. The packaged app contains the final in-app release notes (`1.2.36`).
- The ZIP has a single top-level `Vela.app` and passed archive-integrity verification. The DMG passed checksum verification and mounted successfully.
- `SHA256SUMS.txt` was generated and signed with the release key, whose public key is bundled in the app.

The automated test suites were not run for this release, as requested.
