# Vela Development and Release Guide

For AI agents and developers working in this repository. Write document prose in English; keep commands, filenames, and identifiers in their original form.

## Project Overview

- pnpm workspace: `apps/desktop` (Electron app; main process in `src/main`, renderer in `src/renderer`) and `packages/{agent,shared,tools,workspace}`.
- Only macOS Apple Silicon (arm64) releases are published. The app is not notarized and uses ad-hoc signing.
- See [docs/README.md](docs/README.md) for more topic-specific documentation. The in-app update mechanism is described in [docs/guides/updates.md](docs/guides/updates.md).

## Common Commands

```bash
pnpm install
pnpm dev                 # Development build; data directory: ~/.vela-dev
pnpm test                # Typecheck + all unit tests (must pass before PRs and releases)
pnpm build               # Production build; required before smoke tests
pnpm test:smoke          # Smoke tests in the real Electron app (run pnpm build first)
pnpm test:ui             # Renderer checks in the real Electron app
pnpm --filter @vela/desktop test:updates     # In-app update tests
pnpm runner run --help   # Build and run the Headless CLI (no Electron required); see docs/guides/headless-runner.md
pnpm test:runner         # Headless Runner, CLI, and the Runtime capabilities they depend on
pnpm package:mac         # Package dmg and zip files into apps/desktop/dist
pnpm sign:release        # Generate and sign SHA256SUMS.txt for the update packages
```

## Release Process

In-app updates rely exclusively on GitHub Releases: installed copies of Vela read `releases/latest`, download the zip, verify `SHA256SUMS.txt.sig` with a public key bundled in the app, and then check the hash. **Therefore, release asset names, signatures, and latest-release status are all part of product behavior and must not be changed casually.**

Pushing code and creating or modifying a Release are externally visible actions. Ask the user for confirmation before each step, and proceed only after explicit approval. Approval for one step does not cover later steps.

### 1. Set and Synchronize the Version

Versions follow semver (`X.Y.Z`). The following five fields must match; if any differ, the updater will reject the installation (the extracted `CFBundleShortVersionString` must equal the Release version):

| File | Fields |
| --- | --- |
| `apps/desktop/package.json` | `version`, `shortVersion` |
| `apps/desktop/electron-builder.yml` | `buildVersion`, `mac.bundleShortVersion`, `mac.bundleVersion` |

Also set `version` in `apps/desktop/release-notes.json` to the same version (see the next section).

Do not change `artifactName` (`Vela-${shortVersion}-${arch}.${ext}`); the updater looks for `Vela-<version>-arm64.zip`.

### 2. Write the Release Notes

Rewrite the root `RELEASE_NOTES.md` in English, following the existing structure: `# Vela X.Y.Z` and a summary paragraph, followed by `## New`, `## Improved`, `## Upgrade`, `## Download`, and `## Validation`.

- The `## Download` table must list all four files: `.dmg`, `.zip`, `SHA256SUMS.txt`, and `SHA256SUMS.txt.sig`, and state the package version.
- Under `## Validation`, list only checks that were actually run and passed. Do not list checks that were not run.
- This file is used verbatim as the GitHub Release body, and the updater displays it to users.

### 2b. Update the In-App Release Notes

The in-app “What’s New” onboarding and post-update notification card read `apps/desktop/release-notes.json`. It is shipped with the app (built to `out/main/release-notes.json`) and is **entirely separate from the root `RELEASE_NOTES.md`**: the latter is only the GitHub Release body and is not read by the app.

- Set `version` to the release version. Provide `summary`, `highlights` (`title` + `body`; the UI displays at most four), and `improvements` for each of the five locales: `en`, `zh-CN`, `zh-TW`, `ja`, and `ko`. Keep the number of entries consistent across locales.
- `en` is required. If another locale is missing or malformed, the app falls back to English.
- If the version does not match the app package, the app skips the entire “What’s New” page rather than showing content from an older version.
- `release-notes.test.ts`, included in `pnpm --filter @vela/desktop test`, checks that all five locales are present, their entry counts match, and the version matches `package.json`.

### 3. Validate

```bash
pnpm test                                    # Must pass completely
pnpm build && pnpm test:smoke                # Smoke tests in the real Electron app
pnpm --filter @vela/desktop test:updates
```

### 4. Commit

Commit on `main`, following the historical commit message format: `feat: <change summary>, release X.Y.Z` (use `fix:` for fixes). Add the session-provided `Co-Authored-By` attribution at the end of the commit message. Ask the user before pushing.

### 5. Package and Inspect the Artifacts

```bash
pnpm package:mac
```

This produces `Vela-X.Y.Z-arm64.dmg` and `Vela-X.Y.Z-arm64.zip` in `apps/desktop/dist`. Verify that:

- `plutil -extract CFBundleShortVersionString raw -o - apps/desktop/dist/mac-arm64/Vela.app/Contents/Info.plist` equals `X.Y.Z`, and `CFBundleIdentifier` is `com.vela.desktop`.
- The zip contains only one top-level item, `Vela.app`, and the dmg mounts successfully.

### 6. Sign

```bash
pnpm sign:release
```

This generates `SHA256SUMS.txt` and `SHA256SUMS.txt.sig`, and prints a `gh release upload` command. The script rejects private keys whose corresponding public key is not bundled in the app.

- The private key is at `~/.vela-release/update-signing.key` (or at the path specified by `VELA_UPDATE_KEY`). **Never commit, print, or upload it.** If the key is unavailable, stop and tell the user; do not generate a replacement. The public key corresponding to a new key would not be present in older releases, so those versions could no longer verify updates.
- See [docs/guides/updates.md](docs/guides/updates.md) for key rotation.

### 7. Create the Release

```bash
gh release create vX.Y.Z --target main --title "VelaHarness vX.Y.Z" --notes-file RELEASE_NOTES.md \
  apps/desktop/dist/Vela-X.Y.Z-arm64.dmg \
  apps/desktop/dist/Vela-X.Y.Z-arm64.zip \
  apps/desktop/dist/SHA256SUMS.txt \
  apps/desktop/dist/SHA256SUMS.txt.sig
```

Requirements:

- The tag must be `vX.Y.Z` and must be the highest semver stable release.
- **Do not** pass `--draft` or `--prerelease`, and do not mark an older release as latest. The updater reads `releases/latest`, which ignores drafts and prereleases.
- All four files are required. A Release without the signature file will cause updates to fail for all users with a “signature file missing” error.
- To add or replace files after creation, use `gh release upload ... --clobber`, then repeat the verification steps below.

### 8. Verify After Release

```bash
gh release view vX.Y.Z --json assets,isDraft,isPrerelease --jq '{draft:.isDraft, pre:.isPrerelease, assets:[.assets[].name]}'
gh release list --limit 1        # Should show Latest
```

- There must be exactly the four assets listed above, with `draft` and `pre` both false.
- Download `SHA256SUMS.txt` and `.sig` from the Release and verify them using the app’s `verifySignature` and `updatePublicKeys` (see `apps/desktop/test/update-verify.test.ts`).
- When possible, test the full update flow from the previous installed version: Settings → About & Updates → Check for Updates. Confirm that it downloads, prompts for a restart, and upgrades successfully. If it fails, check `~/.vela/updates/installer.log`.

## Conventions

- Avoid unnecessary secondary labels and descriptions. Let the layout do the explaining.
- Do not commit any files from `~/.vela-release`, and never put private key contents in code, documentation, logs, or conversation.
- After changing update-related logic (`apps/desktop/src/main/update-*.ts`), run `pnpm --filter @vela/desktop test:updates` and `test:updates:ui`.
- New UI copy must be provided in both `zh-CN` and `en`. Add translations for `zh-TW`, `ja`, and `ko` under `packages/shared/src/i18n-messages/`; missing translations fall back to English.
- Installations at version 1.0.5 and earlier do not have an updater. The first version that includes the updater must be installed manually by users.
