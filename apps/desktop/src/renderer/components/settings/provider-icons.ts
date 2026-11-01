/**
 * 供应商 → 图标文件名(assets/providers/<name>.svg,来自 LobeHub Icons 的优先彩色版,没有彩色版的用单色版)。
 * 键是 Pi 的提供方 id;自定义供应商没有固定 id,按名称归一化后再查一次,
 * 所以用户自己建的「DeepSeek」「Ollama」「Kimi」也能拿到对应图标。
 */
const byId: Readonly<Record<string, string>> = {
  "amazon-bedrock": "bedrock-color",
  "ant-ling": "antgroup-color",
  anthropic: "anthropic",
  azure: "azure-color",
  baseten: "baseten",
  cerebras: "cerebras-color",
  "cloudflare-ai-gateway": "cloudflare-color",
  "cloudflare-workers-ai": "cloudflare-color",
  deepseek: "deepseek-color",
  fireworks: "fireworks-color",
  "github-copilot": "copilot-color",
  google: "gemini-color",
  "google-vertex": "vertexai-color",
  groq: "groq",
  huggingface: "huggingface-color",
  "kimi-coding": "kimi-color",
  meta: "meta-color",
  minimax: "minimax-color",
  "minimax-cn": "minimax-color",
  mistral: "mistral-color",
  moonshotai: "moonshot",
  "moonshotai-cn": "moonshot",
  nvidia: "nvidia-color",
  openai: "openai",
  "openai-codex": "openai",
  opencode: "opencode",
  "opencode-go": "opencode",
  openrouter: "openrouter-color",
  "openrouter-api": "openrouter-color",
  "qwen-token-plan": "qwen-color",
  "qwen-token-plan-cn": "qwen-color",
  "qwen-token-plan-individual": "qwen-color",
  together: "together-color",
  "vercel-ai-gateway": "vercel",
  xai: "xai",
  xiaomi: "xiaomimimo",
  "xiaomi-token-plan-ams": "xiaomimimo",
  "xiaomi-token-plan-cn": "xiaomimimo",
  "xiaomi-token-plan-sgp": "xiaomimimo",
  zai: "zai",
  "zai-coding-cn": "zai",
};

/** 自定义供应商常见的名称写法。 */
const byName: Readonly<Record<string, string>> = {
  ollama: "ollama",
  kimi: "kimi-color",
  moonshot: "moonshot",
  deepseek: "deepseek-color",
  openrouter: "openrouter-color",
  zhipu: "zhipu-color",
  bigmodel: "zhipu-color",
  glm: "zhipu-color",
  qwen: "qwen-color",
  alibaba: "alibaba-color",
  bailian: "bailian-color",
  doubao: "doubao-color",
  volcengine: "volcengine-color",
  openai: "openai",
  anthropic: "anthropic",
  gemini: "gemini-color",
  mistral: "mistral-color",
  minimax: "minimax-color",
  siliconflow: "alibaba-color",
};

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** 找不到对应图标时返回 null,调用方退回通用图标或首字母头像。 */
export function providerIconName(provider: { id?: string; name: string }): string | null {
  if (provider.id && byId[provider.id]) return byId[provider.id];
  const key = normalize(provider.name);
  if (byName[key]) return byName[key];
  const id = provider.id ? normalize(provider.id) : "";
  return byName[id] ?? null;
}

export const providerIconNames: readonly string[] = [...new Set([...Object.values(byId), ...Object.values(byName)])];

/** 彩色图标自带配色,按原图显示;其余是单色图标,跟随文字颜色。 */
export function isColorIcon(name: string): boolean {
  return name.endsWith("-color");
}

/** 单色图标里品牌色很强的几个,给它们上品牌色。 */
export const monoIconTint: Readonly<Record<string, string>> = {
  anthropic: "#d97757",
  groq: "#f55036",
};
