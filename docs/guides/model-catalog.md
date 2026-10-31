# 模型列表与手动刷新

设置 → 模型与账号 →「已连接的提供方」顶部有「获取最新模型列表」按钮，立即从 Pi（pi.dev）重新拉取模型。

## 自动刷新的限制

- 启动时刷新一次（`ModelDirectory.refreshCatalogFromNetwork`），结果缓存在 `models-store.json`。
- Pi 对每个提供方有 4 小时的检查间隔，间隔内不会再发请求。手动刷新用 `force` 绕过这个间隔（`refreshCatalogNow`）。
- 只有已登录或已填写密钥的提供方才会联网；设置了 `PI_OFFLINE` 时完全不联网，按钮会提示这一点。
- 单个提供方失败不会让整次刷新报错，失败的提供方与错误信息随结果返回，已缓存的模型照常可用。

## 新模型出现在 pi.dev 却拉不到

pi.dev 按客户端版本过滤模型目录：Pi 的请求会带 `pi-version=<已安装版本>`，较新的模型只返回给足够新的版本。因此「手动刷新也拉不到」多半是 Pi 依赖版本太旧，而不是刷新逻辑的问题。

升级 Pi（`@earendil-works/pi-ai`、`pi-agent-core`、`pi-coding-agent` 三个包保持同一版本）后，需要：

1. 把补丁文件迁移到新版本并更新 `pnpm-workspace.yaml`，见 [MCP 服务器](../features/mcp.md)。
2. 跑 `pnpm test`、`pnpm build && pnpm test:smoke`（其中 `pi-sdk-electron-smoke`、`mcp-electron-smoke` 里写死了 Pi 版本号，需要同步）。
3. 用已登录的提供方实际点一次「获取最新模型列表」。
