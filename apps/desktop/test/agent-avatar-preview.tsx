/** 本地头像预览：真实组件、固定代理数据，不调用模型或主进程。 */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { AgentInfo, ToolTrace } from "@vela/shared";
import { AgentPane } from "../src/renderer/components/AgentPane";
import { AgentWorkspaceProvider } from "../src/renderer/components/AgentPanel";
import { ToolList } from "../src/renderer/components/ToolCard";
import { infoCardDefinitions, type InfoCardContext } from "../src/renderer/components/info-cards/InfoCardContents";
import { AppLocaleProvider } from "../src/renderer/locale";
import "../src/renderer/styles.css";
import "../src/renderer/info-cards.css";

const ids = ["16f02b2a-27cb-4881-bfd2-8897e46ddccc", "c4ac4d2f-112b-4d15-8b35-b39f1213900a", "0925ac7c-c540-49fe-a2c9-e18d3279ed41"];
const agents: AgentInfo[] = ["research", "frontend", "tests"].map((name, index) => ({
  id: ids[index]!, parentId: "root", path: `/root/${name}`, name,
  kind: index === 0 ? "explore" : "general", status: index === 1 ? "running" : "completed",
  depth: 1, task: ["查阅项目结构", "实现本地头像", "补充回归测试"][index]!, steps: [],
  mutated: false, finalText: "使用固定种子，同一代理在不同位置保持同一个头像。", error: null,
  usage: { input: 2000, output: 1000, cacheRead: 0, cacheWrite: 0, total: 3000 },
  activeMs: 42000, runningSince: null, pauseRequested: false, createdAt: index, updatedAt: index,
}));
const tools: ToolTrace[] = agents.map(agent => ({
  id: `spawn-${agent.id}`, name: "spawn_agent", status: "done",
  activity: { agentId: agent.id, agentPath: agent.path, agent: agent.kind === "explore" ? "explore" : "general", body: agent.task },
}));

function Preview() {
  const [activeId, setActiveId] = useState(agents[0]!.id);
  const [dark, setDark] = useState(false);
  const active = agents.find(agent => agent.id === activeId)!;
  document.documentElement.dataset.scheme = dark ? "dark" : "light";
  const Body = infoCardDefinitions.agents.Body;
  return (
    <AppLocaleProvider locale="zh-CN">
      <AgentWorkspaceProvider agents={agents} activeAgentId={activeId} openAgent={setActiveId} closeAgent={() => undefined}>
        <main style={{ height: "100vh", overflow: "auto", background: "var(--bg-chat)", color: "var(--text-primary)", padding: 24 }}>
          <header style={{ display: "flex", justifyContent: "space-between", marginBottom: 24 }}>
            <h1 style={{ fontSize: 18 }}>SubAgent · Bottts</h1>
            <button type="button" onClick={() => setDark(value => !value)}>{dark ? "浅色" : "深色"}</button>
          </header>
          <section style={{ maxWidth: 780, marginBottom: 24 }}>
            <ToolList tools={tools} display="compact" fold="none" />
          </section>
          <section style={{ maxWidth: 780, marginBottom: 24 }}>
            <ToolList tools={tools} display="card" fold="none" />
          </section>
          <section style={{ maxWidth: 420, marginBottom: 24 }}>
            <Body ctx={{ agents, onOpenAgent: setActiveId } as InfoCardContext} />
          </section>
          <section style={{ maxWidth: 900, height: 220, border: "1px solid var(--border-subtle)", display: "flex" }}>
            <AgentPane agent={active} agents={agents} messages={[]} onSwitch={setActiveId}
              ensureMessages={() => undefined} onControl={() => undefined} />
          </section>
        </main>
      </AgentWorkspaceProvider>
    </AppLocaleProvider>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);
