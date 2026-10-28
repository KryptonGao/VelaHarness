# Vela 1.2.6

Vela 1.2.6 adds element annotations to the built-in browser. Point to an element, write a note, and send the Agent its page context and a screenshot alongside your message. This release also keeps complete answers visible when the model follows them with a short closing message.

## New

- **Browser element annotations**: turn on **Annotate** in the browser toolbar, select an element and write a note. Move the selection between parent and child elements, then add more notes before sending. Element notes share the reply-card row above the composer with quoted text replies.
- **Context and screenshots for the Agent**: each annotation includes the page address and title, element description, CSS selector, position and key styles. Messages can include up to four numbered element screenshots; your own attachments take priority when space is limited.
- **Markers and conversation drafts**: numbered markers follow elements as the page scrolls, zooms or changes layout. Element notes stay in memory when switching conversations or hiding the browser. Navigating marks old notes as stale, so their text and descriptions remain sendable; closing a tab removes its notes. Unsent notes are not restored after restarting Vela.

## Improved

- **Complete final answers**: consecutive answer messages separated only by recommended actions or thinking remain visible outside the collapsed process. A short closing message no longer hides the main answer. Copying the final reply includes the related answer messages.
- **Retrying a message**: when a send fails, reply cards, annotation notes and attachments return to the composer. Successful sends clear the associated page markers.
- **Annotation privacy**: page URLs redact common secret parameters, element descriptions do not read filled form values, and element screenshots mask password fields. Annotation controls stay outside the page DOM.
- **Browser control handoff**: annotation mode exits when the Agent takes control of the browser and when switching tabs or conversations, keeping existing notes available for later sending.

## Known issues

Two real-Electron smoke checks still fail with the same symptoms documented in 1.2.5: Task Recipes reports `Missing button 编辑`, and PR Inbox reports `Loaded PRs did not refresh while working outside the inbox`. Those features were not changed in this release.

Five UI suites also fail: `mcp-settings-ui`, `workbench-chat-ui`, `side-chat-ui`, `intelligent-ui-ui` and `agent-inbox-ui`. Each failure was reproduced with the same symptom against the unchanged 1.2.5 source at `a18343c`; they include missing fixture APIs, outdated UI expectations and an assertion that does not include the Ultra thinking level.

## Upgrade

Installed copies of Vela 1.0.6 and later receive this update automatically: Vela downloads it in the background and prompts you to restart. Versions 1.0.5 and earlier cannot update themselves, so install this version manually once: quit Vela completely, replace the application with this version, and reopen it.

Keep your existing `~/.vela` directory (or the directory specified by `VELA_USER_DATA`); no data reset is needed.

The macOS build is not notarized and uses an ad-hoc signature. If macOS blocks first launch, use **Open Anyway** in System Settings → Privacy & Security. Because the code signature differs between versions, macOS may ask you to confirm privacy or keychain access again after an update.

## Download

| File | Platform |
| --- | --- |
| `Vela-1.2.6-arm64.dmg` | macOS Apple Silicon installer |
| `Vela-1.2.6-arm64.zip` | macOS Apple Silicon application bundle (`.app`); also the package used by in-app updates |
| `SHA256SUMS.txt` | SHA-256 checksums for both packages |
| `SHA256SUMS.txt.sig` | Ed25519 signature of `SHA256SUMS.txt`, verified by the in-app updater |

Package version: `1.2.6`. macOS bundle and download version: `1.2.6`.

## Validation

- Browser unit tests passed: 91 tests (`pnpm --filter @vela/desktop test:browser`).
- Turn-review unit tests passed: 24 tests (`pnpm --filter @vela/desktop test:turn-review`).
- Type checks passed for all packages. Unit tests passed in agent (761 passed, one skipped), workspace (208 passed) and desktop (1,092 passed) (`pnpm test`).
- All 29 in-app update tests passed (`pnpm --filter @vela/desktop test:updates`).
- The production build passed (`pnpm build`).
- Thirteen real-Electron smoke suites passed, including browser annotations, browser authentication and automation, MCP, scheduled tasks, handoff, PR review response, notification sounds, settings and thinking display (`pnpm --filter @vela/desktop test:smoke`; see Known issues for the other two suites).
- Nine UI suites passed: plugins, memory settings, web tools, web-tool cards, chat actions, acceptance, races, handoff packs and updates (`pnpm test:ui`; see Known issues for the five baseline failures).
- macOS arm64 packaging completed (`pnpm package:mac`). The application bundle and extracted ZIP report version and build `1.2.6` with identifier `com.vela.desktop`; the ZIP extracts to a single `Vela.app`, and the DMG checksum verifies and mounts successfully.
- The packaged `app.asar` contains the exact five-language `release-notes.json`, application icon and tray icon.
- Signed checksums were generated (`pnpm sign:release`). Both package hashes match, and the Ed25519 signature passes the application's `verifySignature` check with `updatePublicKeys`.
