import { createAvatar } from "@dicebear/core";
import * as bottts from "@dicebear/bottts";

// 会话中的随机 UUID 已持久化：直接作种子即可随机分配，同时跨位置、重载保持一致。
// 固定依赖版本和渲染选项，避免运行状态、名字或主题改变头像。
const avatars = new Map<string, string>();
const cacheLimit = 256;

export function agentAvatarDataUri(agentId: string): string {
  const cached = avatars.get(agentId);
  if (cached) return cached;
  const svg = createAvatar(bottts, {
    seed: agentId,
    size: 64,
    textureProbability: 0,
    eyes: ["eva", "glow", "happy", "robocop", "round"],
    mouth: ["grill01", "smile01", "smile02", "square01"],
  }).toString();
  const uri = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  if (avatars.size >= cacheLimit) avatars.delete(avatars.keys().next().value!);
  avatars.set(agentId, uri);
  return uri;
}
