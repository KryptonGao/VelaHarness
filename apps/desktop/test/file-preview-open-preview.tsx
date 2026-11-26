/** Real App fixture for file-opening preferences and tab replacement. */
import "./workbench-chat-preview";
import "../src/renderer/selection-actions.css";
import { defaultContextLimitSettings, defaultTaskBudgetSettings } from "@vela/shared";
import { setFilePreviewOpenMode } from "../src/renderer/hooks/useFilePreviewOpenMode";

localStorage.setItem("vela.workbenchSplit", "true");
localStorage.setItem("vela.borderlessInterface", new URLSearchParams(location.search).get("borderless") ?? "true");
const examplePath = "apps/desktop/src/renderer/components/example.ts";
const files = ["first.txt", "second.txt", "third.txt", "fourth.txt", examplePath, "guide.md", "image.png", "unreadable.dat",
  ...Array.from({ length: 100 }, (_, i) => `tree-${i.toString().padStart(3, "0")}.txt`)];
const reads: string[] = [];
const externalOpens: string[] = [];
window.vela!.openFile = async path => { externalOpens.push(path); };
window.vela!.setShortcuts = async () => {};
window.vela!.getContextLimit = async () => ({ ...defaultContextLimitSettings });
window.vela!.getTaskBudget = async () => ({ ...defaultTaskBudgetSettings });
window.vela!.getIntelligentUi = async () => ({ preference: "auto", microApps: false });
window.vela!.listWorkspaceFiles = async () => ({ root: "/projects/VelaHarness", files });
window.vela!.readWorkspaceFile = async path => {
  reads.push(path);
  const file = { path, absolutePath: `/projects/VelaHarness/${path}`, size: 1, truncated: false };
  if (path === "unreadable.dat") return { ...file, kind: "binary", content: null };
  if (path === "image.png") return { ...file, kind: "image", content: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==" };
  let content = path === examplePath
    ? `// Contents of ${path}\nexport function clamp(value: number) {\n  const minimum = 0;\n\n  return Math.max(minimum, value);\n}`
    : `Contents of ${path}\nSecond line\nSearch target`;
  if (path === "fourth.txt") content += "\n" + Array.from({ length: 240 }, (_, i) => `Source line ${i + 4}`).join("\n");
  if (path === "guide.md") content = `# Contents of ${path}\n\n[Jump to heading](#target)\n\n${"Paragraph with text.\n\n".repeat(35)}## Target\n\n${"Paragraph with more text.\n\n".repeat(30)}`;
  return { ...file, kind: "text", content, size: content.length };
};
window.vela!.searchWorkspaceCode = async query => ({ query, matches: [{ path: query === "New target" ? "second.txt" : "fourth.txt", line: query === "New target" ? 3 : 120, text: "Search target" }], truncated: false });
Object.assign(window, { fileOpenFixture: { setMode: setFilePreviewOpenMode, reads, externalOpens } });
