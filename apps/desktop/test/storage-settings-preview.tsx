/**
 * Real StoragePage with an in-memory storage API. Open manually (optionally with ?locale=<id>, ?appearance=dark, ?empty=1).
 * Nothing here touches real files.
 */
import type { CheckpointStorageUsage, StorageCategoryId, StorageOverview } from "@vela/shared";
import React from "react";
import { createRoot } from "react-dom/client";
import { settingsCopy } from "../src/renderer/components/settings-copy";
import { StoragePage } from "../src/renderer/components/settings/StoragePage";
import "../src/renderer/styles.css";

const params = new URLSearchParams(location.search);
for (const [key, name] of [["locale", "vela.locale"], ["appearance", "vela.appearance"]] as const) {
  const value = params.get(key);
  if (value) { try { localStorage.setItem(name, value); } catch { /* ignore */ } }
}
const locale = (params.get("locale") ?? "zh-CN") as "zh-CN" | "en";
const MB = 1024 ** 2;

const sizes: Record<StorageCategoryId, number> = params.has("empty")
  ? { conversations: 0, traces: 0, subagents: 0, checkpoints: 0, skills: 0, worktrees: 0, logs: 0, updates: 0, cache: 0, other: 12_000 }
  : { conversations: 240 * MB, traces: 3790 * MB, subagents: 48 * MB, checkpoints: 26 * MB, skills: 63 * MB, worktrees: 410 * MB, logs: 180_000, updates: 92 * MB, cache: 150 * MB, other: 2 * MB };
let conversations: StorageOverview["conversations"] = params.has("empty") ? [] : [
  { id: "a", title: "重构设置页面的存储模块", bytes: 901 * MB, traceBytes: 900 * MB, traceInUse: false },
  { id: "b", title: "Investigate flaky browser tests", bytes: 282 * MB, traceBytes: 280 * MB, traceInUse: true },
  { id: "c", title: null, bytes: 166 * MB, traceBytes: 165 * MB, traceInUse: false },
];
const overview = (): StorageOverview => ({
  home: "/Users/me/.vela",
  totalBytes: Object.values(sizes).reduce((sum, bytes) => sum + bytes, 0),
  categories: (Object.keys(sizes) as StorageCategoryId[]).map(id => ({ id, bytes: sizes[id], files: sizes[id] > 0 ? 10 : 0 })),
  conversations,
  measuredAt: Date.now(),
});
const wait = <T,>(value: T) => new Promise<T>(resolve => setTimeout(() => resolve(value), 300));
const usage: CheckpointStorageUsage = { bytes: sizes.checkpoints, conversations: 12, points: 140 };

(window as unknown as { vela: unknown }).vela = {
  storage: {
    getDisk: () => Promise.resolve({ totalBytes: 494 * 1024 * MB, freeBytes: 210 * 1024 * MB }),
    // ?slow=1 keeps the breakdown measuring for a while to show the placeholder state.
    getOverview: () => new Promise(resolve => setTimeout(() => resolve(overview()), params.has("slow") ? 600_000 : 300)),
    clean: async (category: "traces" | "logs" | "updates" | "cache") => {
      const freedBytes = sizes[category];
      sizes[category] = 0;
      if (category === "traces") conversations = conversations.map(item => item.traceInUse ? item : { ...item, bytes: item.bytes - item.traceBytes, traceBytes: 0 });
      return wait({ freedBytes, removedFiles: 12, skipped: category === "traces" ? 1 : 0, overview: overview() });
    },
    deleteTrace: async (id: string) => {
      const item = conversations.find(entry => entry.id === id)!;
      sizes.traces -= item.traceBytes;
      conversations = conversations.map(entry => entry.id === id ? { ...entry, bytes: entry.bytes - entry.traceBytes, traceBytes: 0 } : entry);
      return wait({ freedBytes: item.traceBytes, removedFiles: 1, skipped: 0, overview: overview() });
    },
    reveal: async () => undefined,
  },
  getCheckpointStorage: () => wait(usage),
  getCheckpointSettings: () => wait({ enabled: true }),
  setCheckpointSettings: (settings: { enabled: boolean }) => wait(settings),
  cleanCheckpointStorage: () => wait({ freedBytes: 0, removedPoints: 0, usage }),
  deleteCheckpointStorage: () => wait({ freedBytes: 0, removedPoints: 0, usage }),
};

createRoot(document.getElementById("root")!).render(<div style={{ maxWidth: 760, margin: "0 auto", padding: 24 }}><StoragePage copy={settingsCopy(locale)} /></div>);
