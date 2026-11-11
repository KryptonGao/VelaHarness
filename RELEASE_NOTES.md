# Vela 1.2.32

Vela 1.2.32 lets final replies embed local images, and removes the lag that appeared when several command outputs were expanded at once. Skill reads also get their own icon in the tool list.

## New

- **Local images in final replies**: replies can now embed workspace-relative, absolute, and `file://` image paths with `![alt](path)`. Local files load with clear loading and missing states, and the system prompt tells the model it can embed saved images. Links keep the existing allowlist, and other Markdown surfaces still accept network images only.

## Improved

- **No more lag when expanding commands**: the edge blur on scroll containers re-rasterized large nested regions every frame and could saturate the GPU once two command outputs were open. Scroll edges and both composer docks now fade to the background instead, so rows no longer appear half sharp and half blurred.
- **Skill-read icon**: rows that read a skill now use their own bookmark-spark icon.

## Upgrade

Installed copies of Vela 1.0.6 and later receive this update automatically: Vela downloads it in the background and prompts you to restart. Versions 1.0.5 and earlier cannot update themselves, so install this version manually once: quit Vela completely, replace the application with this version, and reopen it.

Keep your existing `~/.vela` directory (or the directory specified by `VELA_USER_DATA`); no data reset is needed. Existing conversations open as before.

The macOS build is not notarized and uses an ad-hoc signature. If macOS blocks first launch, use **Open Anyway** in System Settings → Privacy & Security. Because the code signature differs between versions, macOS may ask you to confirm privacy or keychain access again after an update.

## Download

| File | Platform |
| --- | --- |
| `Vela-1.2.32-arm64.dmg` | macOS Apple Silicon installer |
| `Vela-1.2.32-arm64.zip` | macOS Apple Silicon application bundle (`.app`); also the package used by in-app updates |
| `SHA256SUMS.txt` | SHA-256 checksums for both packages |
| `SHA256SUMS.txt.sig` | Ed25519 signature of `SHA256SUMS.txt`, verified by the in-app updater |

Package version: `1.2.32`. macOS bundle and download version: `1.2.32`.

## Validation

- Release metadata verified: all package and macOS bundle version fields are `1.2.32`; all five in-app release-note languages contain two highlights and two improvements.
- Production build and macOS arm64 packaging completed, followed by ad-hoc signing of `Vela.app` and regeneration of the DMG and ZIP from the signed bundle.
- The app extracted from the ZIP and the app in the mounted DMG passed strict code-signature verification and bundle version checks; the bundle identifier is `com.vela.desktop`. The packaged app contains the final in-app release notes (`1.2.32`).
- The ZIP has a single top-level `Vela.app` and passed archive-integrity verification. The DMG passed checksum verification and mounted successfully.
- The Ed25519 checksum signature was verified using the application's `verifySignature` and trusted update public keys, and both package SHA-256 checksums match `SHA256SUMS.txt`.

The automated test suites were not run for this release, as requested.
