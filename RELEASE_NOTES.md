# Vela 1.2.29

Vela 1.2.29 adds a skill marketplace for installing curated skills from GitHub, lets you tune when running-tool details appear in thinking headlines, and fixes diff line numbers and integration card actions.

## New

- **Skill marketplace**: Settings → Skills now has a curated catalog of 24 skills across office, agent, docs, frontend, and engineering categories. Open a skill to read its details, then install it from GitHub with one click.
- **Configurable headline delay**: Settings → Conversation display lets you turn the running-tool delay on or off and set its threshold (100 ms to 5 s, 500 ms by default).

## Improved

- **Calmer thinking headlines**: a running tool appears in the thinking group headline only once the operation is no longer short, so quick calls no longer flash.
- **Accurate diff line numbers**: saved context line numbers are shifted by the running add/delete offset so they point at post-edit positions, and streamed edit diffs no longer show fragment-local numbers that do not match file positions.
- **Safer skill installs**: the marketplace enforces file-count and size limits and checks download paths before writing anything, and its copy is localized in all five languages.
- **Steadier integration cards**: card actions stay in a fixed top-right slot instead of shifting between cards.

## Upgrade

Installed copies of Vela 1.0.6 and later receive this update automatically: Vela downloads it in the background and prompts you to restart. Versions 1.0.5 and earlier cannot update themselves, so install this version manually once: quit Vela completely, replace the application with this version, and reopen it.

Keep your existing `~/.vela` directory (or the directory specified by `VELA_USER_DATA`); no data reset is needed. Existing conversations open as before.

The macOS build is not notarized and uses an ad-hoc signature. If macOS blocks first launch, use **Open Anyway** in System Settings → Privacy & Security. Because the code signature differs between versions, macOS may ask you to confirm privacy or keychain access again after an update.

## Download

| File | Platform |
| --- | --- |
| `Vela-1.2.29-arm64.dmg` | macOS Apple Silicon installer |
| `Vela-1.2.29-arm64.zip` | macOS Apple Silicon application bundle (`.app`); also the package used by in-app updates |
| `SHA256SUMS.txt` | SHA-256 checksums for both packages |
| `SHA256SUMS.txt.sig` | Ed25519 signature of `SHA256SUMS.txt`, verified by the in-app updater |

Package version: `1.2.29`. macOS bundle and download version: `1.2.29`.

## Validation

- Release metadata verified: all package and macOS bundle version fields are `1.2.29`; all five in-app release-note languages contain four highlights and two improvements.
- Production build and macOS arm64 packaging completed, followed by ad-hoc signing of `Vela.app` and regeneration of the DMG and ZIP from the signed bundle.
- The app extracted from the ZIP and the app in the mounted DMG passed strict code-signature verification and bundle version / identifier checks. The packaged app contains the final in-app release notes (`1.2.29`).
- The ZIP has a single top-level `Vela.app` and passed archive-integrity verification. The DMG passed checksum verification and mounted successfully.
- The Ed25519 checksum signature was verified using the application's `verifySignature` and trusted update public keys, and both package SHA-256 checksums match `SHA256SUMS.txt`.

The automated test suites were not run for this release, as requested.
