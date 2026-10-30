# Vela 1.2.10

Vela 1.2.10 shows your ChatGPT subscription usage next to the model name, lets you choose how translucent areas are tinted, adds the Catppuccin file icon theme, and makes info cards and compact file diffs behave more predictably.

## New

- **Subscription usage ring**: when you sign in to GPT with your ChatGPT account, a small ring next to the model name shows how much of your 5-hour and weekly limits has been used. Click it to see each window's usage and reset time. Plans that only have a weekly limit show a single window, and the ring is hidden for other providers or when you are not signed in. The numbers refresh in the background, when you open the popover and after each turn; a temporary network failure keeps the last values instead of hiding the ring.
- **Translucent area tint**: **Settings → Appearance → Translucent area tint** controls how the sidebars, top bar and other translucent areas are covered. **Theme color** keeps the current behavior, **Light/Dark** tints them white in light mode and black in dark mode regardless of theme, and **None** shows only the plain system blur. The glass now turns opaque when the Vela window loses system focus, including when focus moves into the built-in browser.
- **Catppuccin file icons**: **Settings → Appearance → File icon theme** now offers Catppuccin alongside Material Icon Theme and Devicon, for file previews and tool calls.

## Improved

- **Info cards**: cards are hidden only when the remaining text area would be narrower than 1.25 times the card width, instead of following the old 10% shrink budget. Hidden cards stay mounted for measurement and exit animations but no longer capture the pointer, and their clearance next to the composer is measured against the correct edge.
- **Compact file diffs**: a compact diff now opens with its first change in view and no longer fades at the edges.
- **Categories rail**: the selected item uses a filled icon.
- **Localization**: the new interface text is available in Simplified Chinese, Traditional Chinese, English, Japanese and Korean.

## Known issues

Two real-Electron smoke checks still fail with the same symptoms documented in 1.2.6 through 1.2.9: Task Recipes reports `Missing button 编辑`, and PR Inbox reports `Loaded PRs did not refresh while working outside the inbox`. Those features were not changed in this release.

Four UI suites also fail, the same four as in 1.2.8 and 1.2.9: `mcp-settings-ui`, `side-chat-ui`, `intelligent-ui-ui` and `agent-inbox-ui`.

## Upgrade

Installed copies of Vela 1.0.6 and later receive this update automatically: Vela downloads it in the background and prompts you to restart. Versions 1.0.5 and earlier cannot update themselves, so install this version manually once: quit Vela completely, replace the application with this version, and reopen it.

Keep your existing `~/.vela` directory (or the directory specified by `VELA_USER_DATA`); no data reset is needed. Translucent area tint defaults to **Theme color** and the file icon theme keeps your current choice, so the interface looks the same until you change them.

The macOS build is not notarized and uses an ad-hoc signature. If macOS blocks first launch, use **Open Anyway** in System Settings → Privacy & Security. Because the code signature differs between versions, macOS may ask you to confirm privacy or keychain access again after an update.

## Download

| File | Platform |
| --- | --- |
| `Vela-1.2.10-arm64.dmg` | macOS Apple Silicon installer |
| `Vela-1.2.10-arm64.zip` | macOS Apple Silicon application bundle (`.app`); also the package used by in-app updates |
| `SHA256SUMS.txt` | SHA-256 checksums for both packages |
| `SHA256SUMS.txt.sig` | Ed25519 signature of `SHA256SUMS.txt`, verified by the in-app updater |

Package version: `1.2.10`. macOS bundle and download version: `1.2.10`.

## Validation

- Type checks passed for all packages. Unit tests passed in agent (767 passed, one skipped), workspace (208 passed) and desktop (1,152 passed), including the five-language in-app release-notes check (`pnpm test`).
- All 29 in-app update tests passed (`pnpm --filter @vela/desktop test:updates`).
- The production build passed (`pnpm build`).
- Thirteen of fifteen real-Electron smoke suites passed, including settings and thinking blur (`pnpm test:smoke`; see Known issues for the other two suites).
- Twelve of sixteen UI suites passed: plugins, memory settings, web tools, web-tool cards, chat actions, workbench chat, acceptance, races, handoff packs, updates, navigation rail and info cards (`pnpm test:ui`; see Known issues for the four failing suites).
- macOS arm64 packaging completed (`pnpm package:mac`). The application bundle and extracted ZIP report version and build `1.2.10` with identifier `com.vela.desktop`; the ZIP extracts to a single `Vela.app`, and the DMG checksum verifies and mounts successfully.
- The packaged `app.asar` contains `release-notes.json` and the application icon.
- Signed checksums were generated (`pnpm sign:release`). Both package hashes match, and the Ed25519 signature passes the application's `verifySignature` check with `updatePublicKeys`.
