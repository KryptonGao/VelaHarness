/**
 * Real ApprovalRecordsPage with in-memory records. Open manually (optionally ?locale=<id>, ?appearance=dark, ?empty=1).
 * Nothing here touches real settings.
 */
import type { SandboxProjectRecord, VelaApi } from "@vela/shared";
import React from "react";
import { createRoot } from "react-dom/client";
import { settingsCopy } from "../src/renderer/components/settings-copy";
import { ApprovalRecordsPage } from "../src/renderer/components/settings/ApprovalRecordsPage";
import "../src/renderer/styles.css";

const params = new URLSearchParams(location.search);
for (const [key, name] of [["locale", "vela.locale"], ["appearance", "vela.appearance"]] as const) {
  const value = params.get(key);
  if (value) { try { localStorage.setItem(name, value); } catch { /* ignore */ } }
}
const locale = params.get("locale") === "en" ? "en" : "zh-CN";

let records: SandboxProjectRecord[] = params.has("empty") ? [] : [
  { workspace: "/Users/me/code/VelaHarness", allow: ["Bash(pwd *)", "Bash(git status *)", "Bash(pnpm test *)"], deny: ["Bash(rm *)", "Bash(git push *)"] },
  { workspace: "/Users/me/code/StudyPulse", allow: ["Web(domain:developer.mozilla.org)"], deny: [] },
];
const snapshot = (): SandboxProjectRecord[] => records.map((record) => ({ ...record, allow: [...record.allow], deny: [...record.deny] }));
window.vela = {
  listApprovalRecords: async () => snapshot(),
  removeApprovalRecord: async (workspace: string, list: "allow" | "deny", rule: string) => {
    if (params.has("fail")) throw new Error("记录文件无法写入");
    records = records.map((record) => (record.workspace === workspace ? { ...record, [list]: record[list].filter((item) => item !== rule) } : record)).filter((record) => record.allow.length || record.deny.length);
    return snapshot();
  },
  clearApprovalRecords: async (workspace: string) => { records = records.filter((record) => record.workspace !== workspace); return snapshot(); },
} as unknown as VelaApi;

createRoot(document.getElementById("root")!).render(
  <main className="settings-view" style={{ height: "100vh", background: "var(--bg-chat)" }}>
    <div className="settings-body" style={{ height: "100%" }}>
      <div className="settings-content" style={{ flex: 1 }}>
        <header className="settings-page-header"><h2>{settingsCopy(locale).pages.approvals.label}</h2></header>
        <ApprovalRecordsPage copy={settingsCopy(locale)} workspacePath="/Users/me/code/VelaHarness" />
      </div>
    </div>
  </main>,
);
