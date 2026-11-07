# Vela 1.2.25

Vela 1.2.25 redesigns the trace event list, asks before closing a terminal that is still running a command, and stops idle agents from replying again when background work succeeds.

## New

- **Confirm before closing a busy terminal**: closing a terminal tab that may still be running a command now asks first, and ending it terminates the command. Idle terminals close immediately as before.
- **Redesigned trace event list**: events appear as typed rows with new icons, and the list can be filtered by event type. The inspector shows the selected event in the same structure, and an empty filter result says so.

## Improved

- **Quieter idle agents**: when a background command or subagent finishes successfully after the agent has already replied, the result is recorded in context without starting another reply. Failures and timeouts still wake the agent. To get a report after the turn ends, pass `notify_on_exit` to a background `bash` command or `notify_on_finish` to a subagent. Headless runs always wake the agent, since no further user input follows.
- **Live highlighting for file edits**: file edit details are syntax-highlighted while they stream instead of appearing as plain text until the edit completes.
- **Regular-weight serif replies**: serif replies use the font's regular weight without the extra outlining that thickened them.
- **Cleaner docked panel**: the docked right-side panel no longer adds a second sidebar tint, and the paper's outer shadow stays off the transparent panel.
- **No duplicate subagent task message**: a subagent's task message is no longer shown twice when saved history is merged with the live stream.

## Upgrade

Installed copies of Vela 1.0.6 and later receive this update automatically: Vela downloads it in the background and prompts you to restart. Versions 1.0.5 and earlier cannot update themselves, so install this version manually once: quit Vela completely, replace the application with this version, and reopen it.

Keep your existing `~/.vela` directory (or the directory specified by `VELA_USER_DATA`); no data reset is needed. Existing conversations open as before.

The macOS build is not notarized and uses an ad-hoc signature. If macOS blocks first launch, use **Open Anyway** in System Settings → Privacy & Security. Because the code signature differs between versions, macOS may ask you to confirm privacy or keychain access again after an update.

## Download

| File | Platform |
| --- | --- |
| `Vela-1.2.25-arm64.dmg` | macOS Apple Silicon installer |
| `Vela-1.2.25-arm64.zip` | macOS Apple Silicon application bundle (`.app`); also the package used by in-app updates |
| `SHA256SUMS.txt` | SHA-256 checksums for both packages |
| `SHA256SUMS.txt.sig` | Ed25519 signature of `SHA256SUMS.txt`, verified by the in-app updater |

Package version: `1.2.25`. macOS bundle and download version: `1.2.25`.

## Validation

- Release metadata verified: all package and macOS bundle version fields are `1.2.25`; all five in-app release-note languages contain four highlights and four improvements.
- Production build and macOS arm64 packaging completed, followed by ad-hoc signing of `Vela.app` and regeneration of the DMG and ZIP from the signed bundle.
- The local app and the app extracted from the ZIP passed strict code-signature verification and bundle version / identifier checks; the app in the mounted DMG passed strict code-signature verification. The packaged app contains the final in-app release notes (`1.2.25`).
- The ZIP has a single top-level `Vela.app` and passed archive-integrity verification. The DMG passed checksum verification and mounted successfully.
- The Ed25519 checksum signature was verified using the application's `verifySignature` and trusted update public keys, and both package SHA-256 checksums match `SHA256SUMS.txt`.

The automated test suites were not run for this release, as requested.
