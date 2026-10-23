# Vela 1.1.13

Vela 1.1.13 lets the agent search the web and read pages through providers you choose, and polishes the top bar, the new-chat home and the composer.

## New

- **Web search and page reading**: The agent can now search the web with `web_search` and read page text with `web_fetch`. Turn them on in Settings → Web tools and pick a provider for search and for fetching. A DeepSeek preset is built in, and a generic HTTP adapter lets you add your own providers by describing the request and where to find the results in the response.
- **Providers kept apart from your models**: Web providers, endpoints and keys are configured separately from model providers. Keys are stored encrypted with the system keychain, are write-only (never shown again), and never reach the conversation, system prompt, logs or tool results.
- **Approvals for page fetches**: In Ask mode, `web_fetch` asks you to approve each URL; in Smart mode the risk model judges whether the URL could leak private data; in Full access it runs freely. Searching never asks.
- **Tool cards for web tools**: Searches and fetched pages get their own icons in card and compact views, and results render as Markdown.
- **Icons in the top bar**: Conversation, Trace, Version Control, Usage, Context and Usage limit tabs each have an icon.

## Improved

- Content read from the web is wrapped as untrusted data, so instructions inside a page are never followed.
- Only public `http` and `https` addresses can be fetched: URLs with credentials, `localhost`, loopback and private networks are rejected before you are asked, redirects are not followed, and responses are capped.
- Preset prompt cards on the new-chat home carry colored two-tone icons, and the whole set replays its entrance when the project switches between Git and non-Git.
- The stats row under the input now shows output speed, tokens and cache hits only, without the turn and step counts.
- Pop-up menus shrink to fit the window and scroll inside instead of being cut off at the window edge.
- Web tool settings are translated into Simplified Chinese, Traditional Chinese, English, Japanese and Korean.

## Upgrade

Installed copies of Vela 1.0.6 and later receive this update automatically: Vela downloads it in the background and prompts you to restart. Versions 1.0.5 and earlier cannot update themselves, so install this version manually once: quit Vela completely, replace the application with this version, and reopen it.

Keep your existing `~/.vela` directory (or the directory specified by `VELA_USER_DATA`); no data reset is needed. Web tools are off by default until you enable them and add a key.

The macOS build is not notarized and uses an ad-hoc signature. If macOS blocks first launch, use **Open Anyway** in System Settings → Privacy & Security. Because the code signature differs between versions, macOS may ask you to confirm privacy or keychain access again after an update.

## Download

| File | Platform |
| --- | --- |
| `Vela-1.1.13-arm64.dmg` | macOS Apple Silicon installer |
| `Vela-1.1.13-arm64.zip` | macOS Apple Silicon application bundle (`.app`); also the package used by in-app updates |
| `SHA256SUMS.txt` | SHA-256 checksums for both packages |
| `SHA256SUMS.txt.sig` | Ed25519 signature of `SHA256SUMS.txt`, verified by the in-app updater |

Package version: `1.1.13`. macOS bundle and download version: `1.1.13`.

## Validation

- Type checks and unit tests passed (`pnpm test`): 191 workspace, 695 agent and 920 desktop tests passed; one agent test was skipped. An earlier run hit a timing-sensitive `gh-run` test under load; it passes in isolation and on rerun.
- All 29 in-app update tests passed (`pnpm --filter @vela/desktop test:updates`).
- All 67 web tools tests passed (`pnpm --filter @vela/desktop test:web-tools`).
- The production build passed (`pnpm build`).
- Twelve of fourteen real-Electron smoke suites passed. Task Recipes and PR Inbox failed with the same symptoms already documented in earlier releases; these failures remain unresolved.
