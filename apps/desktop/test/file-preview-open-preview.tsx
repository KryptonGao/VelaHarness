/** Real App fixture for file-opening preferences and tab replacement. */
import "./workbench-chat-preview";
import "../src/renderer/selection-actions.css";
import { defaultContextLimitSettings, defaultTaskBudgetSettings } from "@vela/shared";
import { setFilePreviewOpenMode } from "../src/renderer/hooks/useFilePreviewOpenMode";

localStorage.setItem("vela.workbenchSplit", "true");
const examplePath = "apps/desktop/src/renderer/components/example.ts";
const files = ["first.txt", "second.txt", "third.txt", "fourth.txt", examplePath];
const reads: string[] = [];
window.vela!.setShortcuts = async () => {};
window.vela!.getContextLimit = async () => ({ ...defaultContextLimitSettings });
window.vela!.getTaskBudget = async () => ({ ...defaultTaskBudgetSettings });
window.vela!.getIntelligentUi = async () => ({ preference: "auto", microApps: false });
window.vela!.listWorkspaceFiles = async () => ({ root: "/projects/VelaHarness", files });
window.vela!.readWorkspaceFile = async path => {
  reads.push(path);
  const content = path === examplePath
    ? `// Contents of ${path}\nexport function clamp(value: number) {\n  const minimum = 0;\n\n  return Math.max(minimum, value);\n}`
    : `Contents of ${path}\nSecond line\nSearch target`;
  return { path, absolutePath: `/projects/VelaHarness/${path}`, kind: "text", content, size: content.length, truncated: false };
};
window.vela!.searchWorkspaceCode = async query => ({ query, matches: [{ path: query === "New target" ? "second.txt" : "fourth.txt", line: 3, text: "Search target" }], truncated: false });
Object.assign(window, { fileOpenFixture: { setMode: setFilePreviewOpenMode, reads } });
