# Vela 1.1.1

Vela 1.1.1 greatly extends **Intelligent UI**. Besides the declarative calculators and tables from 1.1.0, answers can now contain charts, diagrams, data tied to real tool results, richer views, and (optionally) sandboxed micro apps.

## New

- **Charts and diagrams**: `bar_chart`, `line_chart` and `pie_chart` accept literal data or data from a source. Every chart has a chart view and an accessible data table; the table can be copied as TSV and the chart saved as PNG. `svg_diagram` draws basic shapes and labels with clickable hot spots that only reveal explanations the model supplied. No scripts, event attributes or external resources are ever rendered.
- **Trusted data sources**: an interface can reference a tool call that actually happened in the conversation and show its parsed result (JSON, CSV, lines or text) with its source and freshness (`ok`, `loading`, `stale`, `error`, `empty`). The model cannot invent data and label it as a tool result.
- **Richer views**: `timeline`, `itinerary` (a position sketch only for stops with model-provided coordinates, clearly labelled) and `diff_view`. Chart points that reference number state can be dragged by mouse or keyboard to recompute derived values locally.
- **Continue and refresh**: "Copy as text", "Continue with current settings", refresh-source and suggest-tool-call actions. All of them only compose a normal message to the agent after you confirm the text shown; the interface itself never runs tools, edits files or executes commands, and normal permissions and approvals still apply.
- **Micro apps (advanced, off by default)**: a separate `vela-app` channel for games, canvases and simulations, enabled under **Settings → Conversation display → Interactive UI**. Each app needs a click to run, lives in an opaque-origin sandboxed iframe with a strict CSP, no network, and no access to Electron, Node, the page or storage. It can only ask to submit or copy text through one-time, short-lived capability tokens, and each request needs your confirmation. Apps are stopped when idle, erroring, too long-running or out of view, and are never included in exports.
- **Local metrics and inspector**: counts and durations only (no interface content, nothing uploaded), plus an inspector showing the validated tree, event timeline, state and sources. The inspector is on by default in development builds and opt-in in release builds.

## Improved

- Parser, expression and state handling for Intelligent UI are stricter and cover the new components and limits.
- Conversation export includes charts, diagrams, sources and the new views as plain-text equivalents.
- Interface text for the new features in Traditional Chinese, Japanese and Korean.

## Upgrade

Installed copies of Vela 1.0.6 and later receive this update automatically: Vela downloads it in the background and prompts you to restart. Versions 1.0.5 and earlier cannot update themselves, so install this version manually once: quit Vela completely, replace the application with this version, and reopen it.

Keep your existing `~/.vela` directory (or the directory specified by `VELA_USER_DATA`); no data reset is needed.

The macOS build is not notarized and uses an ad-hoc signature. If macOS blocks first launch, use **Open Anyway** in System Settings → Privacy & Security. Because the code signature differs between versions, macOS may ask you to confirm privacy or keychain access again after an update.

## Download

| File | Platform |
| --- | --- |
| `Vela-1.1.1-arm64.dmg` | macOS Apple Silicon installer |
| `Vela-1.1.1-arm64.zip` | macOS Apple Silicon application bundle (`.app`); also the package used by in-app updates |
| `SHA256SUMS.txt` | SHA-256 checksums for both packages |
| `SHA256SUMS.txt.sig` | Ed25519 signature of `SHA256SUMS.txt`, verified by the in-app updater |

Package version: `1.1.1`. macOS bundle and download version: `1.1.1`.

## Validation

- Type checks and unit tests for all workspace packages (`pnpm test`) passed: 169 workspace, 542 agent, and 830 desktop tests.
- The in-app update tests (`test:updates`, 29 tests) passed.
- The production build succeeded, and 11 of 13 real-Electron smoke suites passed. The Task Recipes and Pull Request Inbox smoke suites still fail; their scripts were not updated for the interface redesign in 1.0.5 and the failures are not caused by this release.
