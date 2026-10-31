# Vela 1.2.15

Vela 1.2.15 adds the Pierre Icons file icon theme and a unique robot avatar for every subagent. Skill reads are now shown as skills, and the main agent replies less often when several subagents or background commands finish close together.

## New

- **Pierre Icons theme**: choose Pierre Icons under Settings → Appearance → File icons. It is the default for new installs; if you already picked a theme, your choice is kept.
- **Subagent avatars**: each subagent gets its own robot avatar, shown in its tab, header, roster menu and the Agents card. The avatar stays the same across views and reloads.
- **Skill reads in tool cards**: reading a skill’s `SKILL.md` is summarized as “Read N skills” instead of being counted as an ordinary file read.

## Improved

- **Fewer redundant replies**: notices from subagents and background commands that finish close together are delivered as one batch, so the main agent responds once.
- **Quiet background commands**: a background command that exits normally without any output no longer wakes the main agent; subagent progress messages are only added to its context.
- **Shorter follow-ups**: when a delivered conclusion needs no action and the final reply has already been given, the agent answers with at most one short sentence instead of repeating earlier results.

## Upgrade

Installed copies of Vela 1.0.6 and later receive this update automatically: Vela downloads it in the background and prompts you to restart. Versions 1.0.5 and earlier cannot update themselves, so install this version manually once: quit Vela completely, replace the application with this version, and reopen it.

Keep your existing `~/.vela` directory (or the directory specified by `VELA_USER_DATA`); no data reset is needed. Existing conversations open as before.

The macOS build is not notarized and uses an ad-hoc signature. If macOS blocks first launch, use **Open Anyway** in System Settings → Privacy & Security. Because the code signature differs between versions, macOS may ask you to confirm privacy or keychain access again after an update.

## Download

| File | Platform |
| --- | --- |
| `Vela-1.2.15-arm64.dmg` | macOS Apple Silicon installer |
| `Vela-1.2.15-arm64.zip` | macOS Apple Silicon application bundle (`.app`); also the package used by in-app updates |
| `SHA256SUMS.txt` | SHA-256 checksums for both packages |
| `SHA256SUMS.txt.sig` | Ed25519 signature of `SHA256SUMS.txt`, verified by the in-app updater |

Package version: `1.2.15`. macOS bundle and download version: `1.2.15`.

## Validation

- Release metadata verified: all package and macOS bundle version fields are `1.2.15`; all five in-app release-note languages contain four highlights and four improvements.
- Production build and macOS arm64 packaging completed (`pnpm package:mac`); bundled in-app release notes match the source file.
- The application bundle reports version `1.2.15` and identifier `com.vela.desktop`. The ZIP was extracted and contains a single `Vela.app` at version `1.2.15`; the DMG checksum verified and the image mounted successfully with the matching application.
- Signed SHA-256 checksums were generated (`pnpm sign:release`). The signature was verified using the application’s `verifySignature` function and built-in `updatePublicKeys`, and both package hashes were recomputed and match.
- The automated test suites were not run for this release.
