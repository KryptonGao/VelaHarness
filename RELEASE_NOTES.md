# Vela 1.1.6

Vela 1.1.6 adds multi-folder workspaces: one workspace can now span several folders, and you can rename, search, and manage workspaces without leaving the app.

## New

- **One workspace, several folders**: Open a workspace's settings and add up to ten additional folders. The agent can read and write every folder in the workspace; commands and relative paths still start from the primary folder, and Git and the terminal stay rooted there too. When a workspace has extra folders, the agent is told about them so it can use absolute paths to reach them.
- **Rename and manage workspaces**: Use the settings button next to a workspace in the sidebar to set a display name, choose a different primary folder, add or remove folders, or remove the workspace from your list.
- **Search the workspace picker**: The workspace picker in the composer now has a search box that matches display names and paths, and marks the current workspace with a check.

## Improved

- Sidebar groups and the workspace picker show the display name you chose for each workspace; clearing the name restores the folder name.
- Workspace changes are validated: every folder must exist, a workspace needs at least one folder, and the folder limit is enforced with clear messages in all five interface languages.
- The workspace picker keeps its "open a folder" and "clear current workspace" actions in a footer, and the recent list no longer needs per-row remove buttons — removal now lives in each workspace's settings.

## Upgrade

Installed copies of Vela 1.0.6 and later receive this update automatically: Vela downloads it in the background and prompts you to restart. Versions 1.0.5 and earlier cannot update themselves, so install this version manually once: quit Vela completely, replace the application with this version, and reopen it.

Keep your existing `~/.vela` directory (or the directory specified by `VELA_USER_DATA`); no data reset is needed. Existing workspaces keep working unchanged and simply start with no extra folders.

The macOS build is not notarized and uses an ad-hoc signature. If macOS blocks first launch, use **Open Anyway** in System Settings → Privacy & Security. Because the code signature differs between versions, macOS may ask you to confirm privacy or keychain access again after an update.

## Download

| File | Platform |
| --- | --- |
| `Vela-1.1.6-arm64.dmg` | macOS Apple Silicon installer |
| `Vela-1.1.6-arm64.zip` | macOS Apple Silicon application bundle (`.app`); also the package used by in-app updates |
| `SHA256SUMS.txt` | SHA-256 checksums for both packages |
| `SHA256SUMS.txt.sig` | Ed25519 signature of `SHA256SUMS.txt`, verified by the in-app updater |

Package version: `1.1.6`. macOS bundle and download version: `1.1.6`.

## Validation

- Type checks and all 1,659 unit tests passed (`pnpm test`): 185 workspace, 585 agent, and 889 desktop tests.
- All 29 in-app update tests passed (`pnpm --filter @vela/desktop test:updates`).
- The production build passed (`pnpm build`).
- Twelve of fourteen real-Electron smoke suites passed. Task Recipes and PR Inbox failed with the same symptoms already documented in the 1.1.4 and 1.1.5 releases; these existing failures remain unresolved.
- The packaged 1.1.6 app launched with isolated data and stayed running.
- Both package SHA-256 checksums matched `SHA256SUMS.txt`.
- The ad-hoc signed application bundle has version `1.1.6` and identifier `com.vela.desktop`; the ZIP contains only `Vela.app`, and the DMG mounted successfully with a valid application signature.
