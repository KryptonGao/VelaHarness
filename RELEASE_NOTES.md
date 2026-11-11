# Vela 1.2.30

Vela 1.2.30 adds an optional review layout for version control, a tint opacity setting for translucent window edges, and provider error cards in the chat stream. The skill marketplace now comes from a signed cloud catalog, and large conversations stream more smoothly.

## New

- **Version control review layout**: Settings → Interface lets you choose Review, which puts the file list and commit composer in one rail with more room for diffs. Classic remains the default, and your choice is remembered across sessions.
- **Provider errors as cards**: usage-limit, rate-limit, overloaded, authentication, and context-length errors from Codex, OpenAI, Anthropic, and Google now appear as a card in the chat stream, with the plan and wait time when the provider reports them. The composer no longer repeats them as a red line.
- **Tint opacity**: Settings → Appearance has a 0–100% slider that sets how strongly the translucent window edges are tinted, with a reset action. It is disabled for the light-mode "None" tint, which has no tint layer.

## Improved

- **Signed skill marketplace**: the catalog and skill files now come from a Cloudflare service instead of being hard-coded in the app. The app verifies catalog and manifest signatures and every file's size and SHA-256 before installing, shows install counts, and falls back to a built-in catalog when the service is unreachable.
- **Smoother large conversations**: large thinking groups and streaming file diffs re-render far less, and diff syntax highlighting is throttled while streaming, so long outputs stay responsive.
- **Simpler thinking headlines**: thinking activity headlines show short localized operation labels while tool details stay in their rows, and compact and card modes share the same typography and shimmer.
- **Tidier settings**: theme grids show three rows with edge-blur scrolling, the Done button is removed, and the glass tint copy is now translated for Traditional Chinese, Japanese, and Korean.

## Upgrade

Installed copies of Vela 1.0.6 and later receive this update automatically: Vela downloads it in the background and prompts you to restart. Versions 1.0.5 and earlier cannot update themselves, so install this version manually once: quit Vela completely, replace the application with this version, and reopen it.

Keep your existing `~/.vela` directory (or the directory specified by `VELA_USER_DATA`); no data reset is needed. Existing conversations open as before.

The macOS build is not notarized and uses an ad-hoc signature. If macOS blocks first launch, use **Open Anyway** in System Settings → Privacy & Security. Because the code signature differs between versions, macOS may ask you to confirm privacy or keychain access again after an update.

## Download

| File | Platform |
| --- | --- |
| `Vela-1.2.30-arm64.dmg` | macOS Apple Silicon installer |
| `Vela-1.2.30-arm64.zip` | macOS Apple Silicon application bundle (`.app`); also the package used by in-app updates |
| `SHA256SUMS.txt` | SHA-256 checksums for both packages |
| `SHA256SUMS.txt.sig` | Ed25519 signature of `SHA256SUMS.txt`, verified by the in-app updater |

Package version: `1.2.30`. macOS bundle and download version: `1.2.30`.

## Validation

- Release metadata verified: all package and macOS bundle version fields are `1.2.30`; all five in-app release-note languages contain four highlights and three improvements.
- Production build and macOS arm64 packaging completed, followed by ad-hoc signing of `Vela.app` and regeneration of the DMG and ZIP from the signed bundle.
- The app extracted from the ZIP and the app in the mounted DMG passed strict code-signature verification and bundle version / identifier checks. The packaged app contains the final in-app release notes (`1.2.30`).
- The ZIP has a single top-level `Vela.app` and passed archive-integrity verification. The DMG passed checksum verification and mounted successfully.
- The Ed25519 checksum signature was verified using the application's `verifySignature` and trusted update public keys, and both package SHA-256 checksums match `SHA256SUMS.txt`.

The automated test suites were not run for this release, as requested.
