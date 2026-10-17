# Vela 1.1.8

Vela 1.1.8 brings the workspace Changes panel onto the same review page used for turn changes, so uncommitted Git changes are read the same way as the changes from a single turn. Large untracked build folders no longer crowd source files out of the workspace file list.

## New

- **Unified Changes review**: The workspace Changes panel now uses the same review page as turn changes: a file tree with filtering on one side and side-by-side diffs on the other. Switching files or refreshing the diff no longer throws you back to the top while the set of changed files is unchanged.
- **Full-width diffs for new files**: A newly created file has no earlier content to compare against, so its diff now fills the whole width instead of leaving half of it empty, and the Before/After labels are hidden when nothing is being compared.

## Improved

- Git file headers such as `diff --git` and `index` are hidden in the review page; the binary-file notice is kept.
- The workspace file list now fills its limit with tracked files first. Untracked build output folders such as Xcode `DerivedData*` are skipped, so a large build directory can no longer push your source folders out of the list and search.
- The review page title, file tree label and empty state are specific to the workspace Changes panel.

## Upgrade

Installed copies of Vela 1.0.6 and later receive this update automatically: Vela downloads it in the background and prompts you to restart. Versions 1.0.5 and earlier cannot update themselves, so install this version manually once: quit Vela completely, replace the application with this version, and reopen it.

Keep your existing `~/.vela` directory (or the directory specified by `VELA_USER_DATA`); no data reset is needed.

The macOS build is not notarized and uses an ad-hoc signature. If macOS blocks first launch, use **Open Anyway** in System Settings → Privacy & Security. Because the code signature differs between versions, macOS may ask you to confirm privacy or keychain access again after an update.

## Download

| File | Platform |
| --- | --- |
| `Vela-1.1.8-arm64.dmg` | macOS Apple Silicon installer |
| `Vela-1.1.8-arm64.zip` | macOS Apple Silicon application bundle (`.app`); also the package used by in-app updates |
| `SHA256SUMS.txt` | SHA-256 checksums for both packages |
| `SHA256SUMS.txt.sig` | Ed25519 signature of `SHA256SUMS.txt`, verified by the in-app updater |

Package version: `1.1.8`. macOS bundle and download version: `1.1.8`.

## Validation

- Type checks and all 1,679 unit tests passed (`pnpm test`): 188 workspace, 599 agent, and 892 desktop tests.
- All 29 in-app update tests passed (`pnpm --filter @vela/desktop test:updates`).
- The production build passed (`pnpm build`).
- Twelve of fourteen real-Electron smoke suites passed. Task Recipes and PR Inbox failed with the same symptoms already documented in earlier releases; these existing failures remain unresolved.
- The packaged 1.1.8 app launched with isolated data and stayed running.
- Both package SHA-256 checksums matched `SHA256SUMS.txt`, and the signed checksum file verified.
- The ad-hoc signed application bundle has version `1.1.8` and identifier `com.vela.desktop`; the ZIP contains only `Vela.app`, and the DMG mounted successfully with a valid application signature.
