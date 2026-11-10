/**
 * Skill 市场云端服务的接入配置。
 * 公钥是 `pnpm market:keygen` 生成的市场专用 Ed25519 公钥（与发版的 update 密钥无关）。
 * 支持多把，轮换时先把新公钥随 App 发出去，再用新私钥签名。
 */
export const marketplacePublicKeys: readonly string[] = ["HXZsjCa/DDzw+YeazwCUn3O5eBGO1s+xqa9eREBQCM8="];

/**
 * 云端服务地址，不带末尾斜杠，路径统一以 /v1 开头。
 * 换成自定义域名时改这里，老版本 App 仍指向 workers.dev，所以旧地址要继续保留一段时间。
 * 留空时客户端视为云端不可用：目录回退到内置目录，安装会提示稍后重试。
 * 开发和测试可以用环境变量 VELA_MARKET_URL 覆盖。
 */
export const marketplaceCloudUrl = "https://vela-skill-market.devchenkai.workers.dev";
