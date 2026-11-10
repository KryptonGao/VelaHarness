/**
 * Real SkillsPage with an in-memory skills API. Open manually (optionally with ?locale=<id>, ?appearance=dark).
 * Install adds the skill to the in-memory catalog; nothing touches real files.
 */
import { marketplaceSkills, type SkillCatalog } from "@vela/shared";
import React from "react";
import { createRoot } from "react-dom/client";
import { settingsCopy } from "../src/renderer/components/settings-copy";
import { SkillsPage } from "../src/renderer/components/settings/SkillsPage";
import "../src/renderer/styles.css";

const params = new URLSearchParams(location.search);
for (const [key, name] of [["locale", "vela.locale"], ["appearance", "vela.appearance"]] as const) {
  const value = params.get(key);
  if (value) { try { localStorage.setItem(name, value); } catch { /* ignore */ } }
}
const locale = (params.get("locale") ?? "zh-CN") as "zh-CN" | "en";
const wait = <T,>(value: T) => new Promise<T>(resolve => setTimeout(() => resolve(value), 600));

const catalog: SkillCatalog = {
  skillsDir: "/Users/me/.vela/skills",
  diagnostics: [],
  skills: [
    { name: "apple-design", description: "Apple's approach to interface design and fluid motion.", location: "/Users/me/.vela/skills/apple-design/SKILL.md", origin: "user", disableModelInvocation: false, enabled: true, canDelete: true },
    { name: "pdf", description: "Read and extract PDF content.", location: "/Users/me/.vela/skills/pdf/SKILL.md", origin: "user", disableModelInvocation: false, enabled: true, canDelete: true },
  ],
};

(window as unknown as { vela: unknown }).vela = {
  listSkills: () => Promise.resolve(catalog),
  setSkillEnabled: () => Promise.resolve(catalog),
  deleteSkill: async (name: string) => {
    await wait(null);
    catalog.skills = catalog.skills.filter(skill => skill.name !== name);
    return { ...catalog, skills: [...catalog.skills] };
  },
  // ?nostats 模拟云端取不到安装次数；默认模拟云端目录带次数。
  loadMarketplace: async () => {
    await wait(null);
    const installs = Object.fromEntries(marketplaceSkills.map((entry, index) => [entry.id, Math.max(0, 1800 - index * 83)]));
    return { skills: [...marketplaceSkills], source: "cloud" as const, installs: params.has("nostats") ? null : installs };
  },
  installMarketplaceSkill: async (id: string) => {
    if (params.has("fail")) { await wait(null); throw new Error("无法连接市场服务，请检查网络后重试"); }
    await wait(null);
    catalog.skills.push({ name: id, description: `${id} skill`, location: `/Users/me/.vela/skills/${id}/SKILL.md`, origin: "user", disableModelInvocation: false, enabled: true, canDelete: true });
    return { ...catalog, skills: [...catalog.skills] };
  },
};

createRoot(document.getElementById("root")!).render(<div style={{ maxWidth: 800, margin: "0 auto", padding: 24 }}><SkillsPage copy={settingsCopy(locale)} workspacePath={null} /></div>);
