# Vela 1.2.23

Vela 1.2.23 brings chat modes and execution permissions into one menu, shows workspace and model information earlier at startup, and refines the composer and file preview layout.

## New

- **Combined mode menu**: choose **Auto**, **Manual**, **Full access**, **Plan** or **Goal** from one composer control, with **Race** and previous race results available when supported. Permission choices include descriptions, Auto is marked as recommended, and number keys select entries while the menu is open.
- **Keep separate controls if you prefer**: the combined menu is enabled by default. Turn off **Settings → Interface → Combined mode menu** to restore the individual chat-mode and execution-permission controls. Choosing Plan or Goal keeps the current permissions, which remain visible in the menu; recipe-locked permissions stay protected.

## Improved

- **Earlier startup information**: the last workspace appears without waiting for Git and pull-request queries. When available, saved branch and model hints fill the initial display until live information arrives. Git attachment and session startup run in parallel, and the selected model appears before skills and MCP resources finish loading. These display hints do not bypass session-readiness checks for sending messages.
- **Compact reasoning controls**: the effort label, icon and arrow sit together without reserving space for the longest label. The English **Extra high** label is now **Extra**, and the capsule composer brings the reasoning-effort and model controls closer together.
- **Cleaner file previews**: the file browser no longer shows a placeholder icon or instructions when no file is open. The preview container no longer has an outer margin, rounded corners or a card shadow.
- **Optional structured outcomes**: agent guidance now treats `submit_outcome` as optional rather than requiring it before every final reply after changes or verification. Completing a Goal still requires a validation record.
- The new combined-menu text and setting are available in all five interface languages.

## Upgrade

Installed copies of Vela 1.0.6 and later receive this update automatically: Vela downloads it in the background and prompts you to restart. Versions 1.0.5 and earlier cannot update themselves, so install this version manually once: quit Vela completely, replace the application with this version, and reopen it.

Keep your existing `~/.vela` directory (or the directory specified by `VELA_USER_DATA`); no data reset is needed. Existing conversations open as before.

The macOS build is not notarized and uses an ad-hoc signature. If macOS blocks first launch, use **Open Anyway** in System Settings → Privacy & Security. Because the code signature differs between versions, macOS may ask you to confirm privacy or keychain access again after an update.

## Download

| File | Platform |
| --- | --- |
| `Vela-1.2.23-arm64.dmg` | macOS Apple Silicon installer |
| `Vela-1.2.23-arm64.zip` | macOS Apple Silicon application bundle (`.app`); also the package used by in-app updates |
| `SHA256SUMS.txt` | SHA-256 checksums for both packages |
| `SHA256SUMS.txt.sig` | Ed25519 signature of `SHA256SUMS.txt`, verified by the in-app updater |

Package version: `1.2.23`. macOS bundle and download version: `1.2.23`.

## Validation

- Release metadata verified: all package and macOS bundle version fields are `1.2.23`; all five in-app release-note languages contain four highlights and five improvements.
- Production build and macOS arm64 packaging completed, followed by ad-hoc signing of `Vela.app` and regeneration of the DMG and ZIP from the signed bundle.
- The local app, app extracted from the ZIP, and app in the mounted DMG all passed strict code-signature verification and bundle version / identifier checks. Their application archives are identical and contain the final in-app release notes.
- The ZIP has a single top-level `Vela.app` and passed archive-integrity verification. The DMG passed checksum verification and mounted successfully.
- Both package SHA-256 checksums and the Ed25519 checksum signature were verified using the application's `verifySignature` and trusted update public keys; the packaged app contains the trusted key.

The automated test suites were not run for this release, as requested.
