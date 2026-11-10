# Skill 市场（云端分发）

Skill 市场的目录与 Skill 内容由 Cloudflare Worker 分发，客户端验签、核对哈希后才安装。更新目录不需要发新版 App，安装不再依赖 GitHub API。设计背景见 [skill-market-cloud-prd.md](../skill-market-cloud-prd.md)。

## 组成

| 位置 | 作用 |
| --- | --- |
| `services/skill-market/catalog.json` | 维护者自选的目录，唯一的人工维护入口。每条记录上游仓库、Skill 名、分类和**审核过的上游 commit**。 |
| `services/skill-market/scripts/build.ts` | 本机建置：从固定 commit 取文件，生成 manifest 与目录，用私钥签名，写到 `public/v1/`，并重新生成内置目录。 |
| `services/skill-market/public/v1/` | 建置产物，随 git 提交，由 Workers Static Assets 提供。含 `catalog.json`、`skills/<id>/manifest.json`、`skills/<id>/files/*`，以及各自的 `.sig`。 |
| `services/skill-market/src/worker.ts` | 只处理 `GET /v1/skills/:id/manifest.json`（计数后原样回传）与 `GET /v1/stats.json`，其余请求交给 Static Assets。 |
| `packages/shared/src/marketplace-protocol.ts` | 目录与 manifest 的格式、校验和上限，构建脚本与客户端共用。 |
| `packages/shared/src/marketplace-config.ts` | 内置的市场公钥与云端地址。 |
| `packages/shared/src/marketplace-builtin.ts` | 内置目录，由建置脚本生成，不要手改；云端不可用时使用。 |
| `packages/agent/src/skill-marketplace.ts` | 客户端：加载目录与安装次数、验签安装。 |

服务目录是独立的 npm 项目（有自己的 `package-lock.json`），不在 pnpm workspace 里，本地调试用 `npm ci`。类型检查与测试由根目录的 `pnpm test` 覆盖（`typecheck:market`、`test:market`）。Workers Builds 会按仓库根目录的 `pnpm-lock.yaml` 安装整个 workspace（含 Electron 的 postinstall，约 25 秒，不影响结果），部署时再用 `npx wrangler` 临时取 wrangler。

## 信任链

- 目录与每个 manifest 各有一份独立的 Ed25519 签名（对原始字节签名，签名文件是 base64 文本）。
- 目录里记录每个 manifest 的 SHA-256，manifest 记录每个文件的路径、大小与 SHA-256。
- 客户端先验目录签名（失败就用内置目录，只影响列表），安装时必须验 manifest 签名，再逐文件核对大小和哈希。签名无效、哈希不符、路径不安全、超过上限、manifest 与请求的 Skill 不符，一律取消安装，不留下半个 Skill。
- 私钥只在维护者本机，默认 `~/.vela-market/market-signing.key`（可用 `VELA_MARKET_KEY` 指定）。不进仓库、Cloudflare、CI，与发版用的 update 密钥无关。公钥写在 `marketplacePublicKeys`，可以有多把以便轮换。

## 维护者流程

首次：

```bash
pnpm market:keygen          # 生成私钥并打印公钥；把公钥填进 marketplacePublicKeys，并备份私钥
pnpm market:keygen --show   # 之后随时查看现有私钥对应的公钥
```

新增、下架或改分类：编辑 `services/skill-market/catalog.json`（新增时 `commit` 填审核过的 40 位 SHA），然后：

```bash
pnpm market:build
git diff services/skill-market packages/shared/src/marketplace-builtin.ts
```

纳入上游的新版本：

```bash
pnpm market:build --update          # 全部 Skill 更新到上游当前 HEAD
pnpm market:build --update docx pdf # 只更新指定的 Skill
git diff services/skill-market/public   # 审核上游改了什么，满意再提交
```

审核通过后 commit 并 push，Workers Builds 会自动部署。出问题时 `git revert` 再 push 即可回滚。`pnpm test` 里的 `published.test.ts` 会检查 `public/` 的签名、哈希和内置目录是否与 `catalog.json` 一致，改了目录忘了重新建置会失败。

构建脚本会拒绝符号链接、子模块，以及 Static Assets 会改写或丢弃的路径（空格、`#`、`?`、`.DS_Store` 等），也会在建置时检查与客户端相同的文件数和大小上限。

## 部署

一次性设置在 Cloudflare 控制台完成：

1. 创建 D1 数据库，`database_id` 已写在 `wrangler.jsonc`。
2. Workers & Pages → Import a repository，授权 GitHub 并选择本仓库。
3. Worker 名称 `vela-skill-market`（必须与 `wrangler.jsonc` 的 `name` 一致）；Root directory `services/skill-market`；Build watch paths `services/skill-market/*`；Deploy command `npx wrangler d1 migrations apply DB --remote && npx wrangler deploy`（想固定版本可写成 `npx wrangler@4.160.0 ...`，否则每次取最新的 wrangler）。
4. 首次部署成功后，把 `workers.dev` 地址（不带末尾斜杠）填进 `packages/shared/src/marketplace-config.ts` 的 `marketplaceCloudUrl`。当前线上地址是 `https://vela-skill-market.devchenkai.workers.dev`，已填入。

本地调试：`cd services/skill-market && npm ci && npx wrangler dev`。

**发版顺序**：`marketplaceCloudUrl` 为空或服务不可用时，客户端只能用内置目录，安装会提示稍后重试（不再有直连 GitHub 的安装路径）。发布带这项改动的 App 之前，先确认线上服务可用。

## 安装统计

- 只有安装流程会请求 `manifest.json`，Worker 在回传时给该 Skill 在 D1 的计数加 1；浏览目录、HEAD 请求、不存在的 Skill 都不计数。
- 表里只有 Skill id 与次数，不写 IP、设备或使用者信息。速率限制只用 Cloudflare 的限流计数器（每个来源每分钟最多计 20 次，超出时照常回传 manifest，只是不再计数）。
- `stats.json` 不签名，仅用于展示，边缘缓存 5 分钟（缓存键只看路径，不受查询串影响）；客户端取不到就不显示次数，所以刚安装完看到的次数可能晚几分钟才更新。
- 安装失败或重试也可能被计入，数字只反映受欢迎程度。

## 已知限制

- 客户端不记住已见过的最高目录版本，拿到 Cloudflare 权限的攻击者可以回放旧的、仍然有效签名的目录。目录对 manifest 的哈希钉住了同一时刻的内容，因此回放只会退回到曾经审核过的旧版本。
- 公钥泄露无碍，私钥泄露需要汰除该公钥并发布新版 App。
