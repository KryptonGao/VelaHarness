// 由 `pnpm market:build` 根据 services/skill-market/catalog.json 生成，请勿手改。
import type { MarketplaceSkillEntry } from "./marketplace-protocol";

/** 内置的市场目录：云端目录不可用或验签失败时使用。 */
export const marketplaceSkills: readonly MarketplaceSkillEntry[] = [
  { id: "docx", source: "anthropics/skills", skill: "docx", category: "office" },
  { id: "xlsx", source: "anthropics/skills", skill: "xlsx", category: "office" },
  { id: "pptx", source: "anthropics/skills", skill: "pptx", category: "office" },
  { id: "pdf", source: "anthropics/skills", skill: "pdf", category: "office" },
  { id: "find-skills", source: "vercel-labs/skills", skill: "find-skills", category: "agent" },
  { id: "skill-creator", source: "anthropics/skills", skill: "skill-creator", category: "agent" },
  { id: "agent-browser", source: "vercel-labs/agent-browser", skill: "agent-browser", category: "agent" },
  { id: "mcp-builder", source: "anthropics/skills", skill: "mcp-builder", category: "agent" },
  { id: "grill-me", source: "mattpocock/skills", skill: "grill-me", category: "agent" },
  { id: "handoff", source: "mattpocock/skills", skill: "handoff", category: "agent" },
  { id: "writing-for-agents", source: "mattpocock/skills", skill: "writing-for-agents", category: "agent" },
  { id: "doc-coauthoring", source: "anthropics/skills", skill: "doc-coauthoring", category: "docs" },
  { id: "web-artifacts-builder", source: "anthropics/skills", skill: "web-artifacts-builder", category: "docs" },
  { id: "frontend-design", source: "anthropics/skills", skill: "frontend-design", category: "frontend" },
  { id: "web-design-guidelines", source: "vercel-labs/agent-skills", skill: "web-design-guidelines", category: "frontend" },
  { id: "vercel-react-best-practices", source: "vercel-labs/agent-skills", skill: "vercel-react-best-practices", dir: "react-best-practices", category: "frontend" },
  { id: "webapp-testing", source: "anthropics/skills", skill: "webapp-testing", category: "engineering" },
  { id: "improve-codebase-architecture", source: "mattpocock/skills", skill: "improve-codebase-architecture", category: "engineering" },
  { id: "tdd", source: "mattpocock/skills", skill: "tdd", category: "engineering" },
  { id: "systematic-debugging", source: "obra/superpowers", skill: "systematic-debugging", category: "engineering" },
  { id: "writing-plans", source: "obra/superpowers", skill: "writing-plans", category: "engineering" },
  { id: "verification-before-completion", source: "obra/superpowers", skill: "verification-before-completion", category: "engineering" },
  { id: "brainstorming", source: "obra/superpowers", skill: "brainstorming", category: "engineering" },
  { id: "executing-plans", source: "obra/superpowers", skill: "executing-plans", category: "engineering" },
];
