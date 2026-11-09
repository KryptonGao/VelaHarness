# Vela 1.2.28

Vela 1.2.28 adds built-in PostHog and Supabase connectors, shows live tool details in thinking headlines, opens Integrations instantly from a cached catalog, and moves the acceptance entry into the reply action row.

## New

- **PostHog connector**: connect PostHog from Integrations through the standard OAuth sign-in; the provider's consent screen decides the scopes.
- **Supabase connector**: connect Supabase from Integrations through the standard OAuth sign-in.
- **Live tool details in thinking**: the thinking group headline shows what the running tool is doing, such as the command or file in progress.
- **Acceptance in the reply row**: the acceptance entry now sits in the reply action row, next to the other actions on each reply.

## Improved

- **Instant Integrations page**: Integrations shows the last known connectors immediately and swaps in fresh results once the connector handshakes settle, instead of a loading state.
- **More greetings**: the start page offers more time-of-day greetings.
- **Clearer MCP tool results**: results from the new connectors show their source link.
- **Cleaner changes review**: pure deletions fill the full width, and todo status icons line up with their text.
- **Quieter visuals**: native title tooltips no longer appear outside the custom button tooltip, and accent buttons and the Integrations search box lose the colored glow and focus ring.

## Upgrade

Installed copies of Vela 1.0.6 and later receive this update automatically: Vela downloads it in the background and prompts you to restart. Versions 1.0.5 and earlier cannot update themselves, so install this version manually once: quit Vela completely, replace the application with this version, and reopen it.

Keep your existing `~/.vela` directory (or the directory specified by `VELA_USER_DATA`); no data reset is needed. Existing conversations open as before.

The macOS build is not notarized and uses an ad-hoc signature. If macOS blocks first launch, use **Open Anyway** in System Settings → Privacy & Security. Because the code signature differs between versions, macOS may ask you to confirm privacy or keychain access again after an update.

## Download

| File | Platform |
| --- | --- |
| `Vela-1.2.28-arm64.dmg` | macOS Apple Silicon installer |
| `Vela-1.2.28-arm64.zip` | macOS Apple Silicon application bundle (`.app`); also the package used by in-app updates |
| `SHA256SUMS.txt` | SHA-256 checksums for both packages |
| `SHA256SUMS.txt.sig` | Ed25519 signature of `SHA256SUMS.txt`, verified by the in-app updater |

Package version: `1.2.28`. macOS bundle and download version: `1.2.28`.

## Validation

- Release metadata verified: all package and macOS bundle version fields are `1.2.28`; all five in-app release-note languages contain four highlights and three improvements.
- Production build and macOS arm64 packaging completed, followed by ad-hoc signing of `Vela.app` and regeneration of the DMG and ZIP from the signed bundle.
- The local app, the app extracted from the ZIP, and the app in the mounted DMG passed strict code-signature verification and bundle version / identifier checks. The packaged app contains the final in-app release notes (`1.2.28`).
- The ZIP has a single top-level `Vela.app` and passed archive-integrity verification. The DMG passed checksum verification and mounted successfully.
- The Ed25519 checksum signature was verified using the application's `verifySignature` and trusted update public keys, and both package SHA-256 checksums match `SHA256SUMS.txt`.

The automated test suites were not run for this release, as requested.
