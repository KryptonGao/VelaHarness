# Vela 1.2.22

Vela 1.2.22 reorganizes Settings into grouped cards, adds customizable app shortcuts, and makes it easier to move between chats and workbench tabs.

## New

- **Customizable app shortcuts**: in **Settings → Shortcuts**, click a binding to change it, add up to three bindings per supported app action, or clear a binding. Conflicting combinations and reserved system or editing shortcuts are flagged. Changes are saved and apply immediately; restore one action or all defaults whenever needed. Search, send, newline and Escape remain fixed.
- **Chat and tab navigation**: switch to the next or previous chat or workbench tab, with wraparound, or jump to the next other chat waiting for input or reporting an error. On macOS, the default shortcuts are **⌘⌥] / ⌘⌥[** for chats, **⌘⇧] / ⌘⇧[** (also **⌃Tab / ⌃⇧Tab**) for tabs, and **⌘⌥A** for the next chat needing attention.
- **More app-menu actions**: archive the current chat, open the existing side chat, or switch chats and workbench tabs from the app menus. Related menu accelerators follow your customized shortcut settings.

## Improved

- **Grouped settings cards**: rounded cards keep each setting and its controls on one row, with icon-led navigation, clearer page titles and centered content. Switches, segmented controls and buttons share consistent styling. Theme and conversation-display previews stay as they are.
- **Consistent settings dropdowns**: custom dropdown menus show a checkmark for the selected option and support arrow keys, Enter to select, and Escape to dismiss.
- **Keyboard-layout handling**: app shortcuts match physical key positions, so Option-modified characters do not change the recognized combination.
- New interface text is available in all five interface languages.

## Upgrade

Installed copies of Vela 1.0.6 and later receive this update automatically: Vela downloads it in the background and prompts you to restart. Versions 1.0.5 and earlier cannot update themselves, so install this version manually once: quit Vela completely, replace the application with this version, and reopen it.

Keep your existing `~/.vela` directory (or the directory specified by `VELA_USER_DATA`); no data reset is needed. Existing conversations open as before.

The macOS build is not notarized and uses an ad-hoc signature. If macOS blocks first launch, use **Open Anyway** in System Settings → Privacy & Security. Because the code signature differs between versions, macOS may ask you to confirm privacy or keychain access again after an update.

## Download

| File | Platform |
| --- | --- |
| `Vela-1.2.22-arm64.dmg` | macOS Apple Silicon installer |
| `Vela-1.2.22-arm64.zip` | macOS Apple Silicon application bundle (`.app`); also the package used by in-app updates |
| `SHA256SUMS.txt` | SHA-256 checksums for both packages |
| `SHA256SUMS.txt.sig` | Ed25519 signature of `SHA256SUMS.txt`, verified by the in-app updater |

Package version: `1.2.22`. macOS bundle and download version: `1.2.22`.

## Validation

- Release metadata verified: all package and macOS bundle version fields are `1.2.22`; all five in-app release-note languages contain four highlights and five improvements.
- Production build and macOS arm64 packaging completed (`pnpm package:mac`), followed by ad-hoc signing of `Vela.app` and regeneration of the DMG and ZIP from the signed bundle.
- The local app, app extracted from the ZIP, and app in the mounted DMG all passed strict code-signature verification and bundle version / identifier checks. The ZIP has a single top-level `Vela.app` and passed archive-integrity verification.
- Both package SHA-256 checksums and the Ed25519 checksum signature were verified with the application's trusted public keys.

The automated test suites were not run for this release, as requested.
