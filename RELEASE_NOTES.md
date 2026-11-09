# Vela 1.2.27

Vela 1.2.27 adds built-in DeepWiki, Linear, and Cloudflare connectors with search on the Integrations page, shows MCP tool results more clearly, and shows connector status without a transient "connecting" state.

## New

- **DeepWiki connector**: connect DeepWiki from Integrations with no sign-in or stored credentials.
- **Linear connector**: connect Linear from Integrations through the standard OAuth sign-in.
- **Cloudflare connector**: connect Cloudflare from Integrations.
- **Search on Integrations**: a search box helps you find connectors quickly.

## Improved

- **Settled connector status**: enabled connectors now report their real state when Settings opens, instead of briefly showing "connecting".
- **Clearer MCP tool results**: tool search and MCP resource tools are labeled as MCP, and the `mcp__` prefix is no longer shown in tool names. MCP results from the new connectors show their source.
- **Consistent settings pages**: Integrations, MCP, Memory, and Usage settings use the shared page title, and settings navigation labels stay on one line.
- **Small visual fixes**: the todo status icon in tool card headers is vertically centered, and compact question text is shown in gray.

## Upgrade

Installed copies of Vela 1.0.6 and later receive this update automatically: Vela downloads it in the background and prompts you to restart. Versions 1.0.5 and earlier cannot update themselves, so install this version manually once: quit Vela completely, replace the application with this version, and reopen it.

Keep your existing `~/.vela` directory (or the directory specified by `VELA_USER_DATA`); no data reset is needed. Existing conversations open as before.

The macOS build is not notarized and uses an ad-hoc signature. If macOS blocks first launch, use **Open Anyway** in System Settings → Privacy & Security. Because the code signature differs between versions, macOS may ask you to confirm privacy or keychain access again after an update.

## Download

| File | Platform |
| --- | --- |
| `Vela-1.2.27-arm64.dmg` | macOS Apple Silicon installer |
| `Vela-1.2.27-arm64.zip` | macOS Apple Silicon application bundle (`.app`); also the package used by in-app updates |
| `SHA256SUMS.txt` | SHA-256 checksums for both packages |
| `SHA256SUMS.txt.sig` | Ed25519 signature of `SHA256SUMS.txt`, verified by the in-app updater |

Package version: `1.2.27`. macOS bundle and download version: `1.2.27`.

## Validation

- Release metadata verified: all package and macOS bundle version fields are `1.2.27`; all five in-app release-note languages contain four highlights and three improvements.
- Production build and macOS arm64 packaging completed, followed by ad-hoc signing of `Vela.app` and regeneration of the DMG and ZIP from the signed bundle.
- The local app, the app extracted from the ZIP, and the app in the mounted DMG passed strict code-signature verification and bundle version / identifier checks. The packaged app contains the final in-app release notes (`1.2.27`).
- The ZIP has a single top-level `Vela.app` and passed archive-integrity verification. The DMG passed checksum verification and mounted successfully.
- The Ed25519 checksum signature was verified using the application's `verifySignature` and trusted update public keys, and both package SHA-256 checksums match `SHA256SUMS.txt`.

The automated test suites were not run for this release, as requested.
