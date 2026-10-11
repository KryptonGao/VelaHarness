# Vela 1.1.3

Vela 1.1.3 introduces a new illustrated welcome tour, an eight-step setup flow, and release highlights that are available offline in your language.

## New

- **A new welcome tour**: Meet Vela through an illustrated introduction, then explore parallel agents, execution traces, and compact conversations with screenshots from the app.
- **Eight steps to get ready**: Choose your language, appearance, information layout, skills, model, permissions, memory and instructions, and background behavior. Optional steps can be skipped, and unfinished setup resumes where you left off.
- **What is new, right in the app**: The welcome tour and the first launch after an update show release highlights from the installed app. Notes work offline and only appear when their version matches the app.
- **Replay the introduction**: Open Settings → About & updates to revisit the introduction and current release highlights without changing your saved preferences.

## Improved

- Setup previews light and dark themes while keeping the illustrated guide readable in its own light palette.
- The final setup page can open a project folder or take you directly to the relevant settings page.
- Welcome, setup, and release highlights are available in English, Simplified Chinese, Traditional Chinese, Japanese, and Korean.
- Development settings include a way to restart onboarding without clearing saved preferences.

## Upgrade

Installed copies of Vela 1.0.6 and later receive this update automatically: Vela downloads it in the background and prompts you to restart. Versions 1.0.5 and earlier cannot update themselves, so install this version manually once: quit Vela completely, replace the application with this version, and reopen it.

Keep your existing `~/.vela` directory (or the directory specified by `VELA_USER_DATA`); no data reset is needed.

The macOS build is not notarized and uses an ad-hoc signature. If macOS blocks first launch, use **Open Anyway** in System Settings → Privacy & Security. Because the code signature differs between versions, macOS may ask you to confirm privacy or keychain access again after an update.

## Download

| File | Platform |
| --- | --- |
| `Vela-1.1.3-arm64.dmg` | macOS Apple Silicon installer |
| `Vela-1.1.3-arm64.zip` | macOS Apple Silicon application bundle (`.app`); also the package used by in-app updates |
| `SHA256SUMS.txt` | SHA-256 checksums for both packages |
| `SHA256SUMS.txt.sig` | Ed25519 signature of `SHA256SUMS.txt`, verified by the in-app updater |

Package version: `1.1.3`. macOS bundle and download version: `1.1.3`.

## Validation

- Type checks and all 1,603 unit tests passed (`pnpm test`): 169 workspace, 573 agent, and 861 desktop tests.
- All 29 in-app update tests passed (`pnpm --filter @vela/desktop test:updates`).
- The production build passed (`pnpm build`).
- All 17 real-Electron onboarding flow checks passed, along with the updates UI suite.
- Twelve real-Electron smoke suites passed, including Pi SDK compatibility, profile isolation, browser workflows, MCP, scheduled tasks, handoffs, PR review responses, notification sounds, settings, and thinking blur. Browser-use passed on a targeted rerun.
- The signed, packaged Vela 1.1.3 application launched with isolated data, loaded matching release notes in all five languages, displayed the current release card, and kept it dismissed after reload.
- Both distribution packages contain a valid ad-hoc signed application bundle with version `1.1.3` and identifier `com.vela.desktop`; the zip contains only `Vela.app`, and the DMG mounted successfully.
- The application updater verified the release checksum signature against its built-in public key, and both package SHA-256 checksums matched.
