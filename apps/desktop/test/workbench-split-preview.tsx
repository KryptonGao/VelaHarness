import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { AppLocaleProvider, setActiveLocale, type AppLocale } from "../src/renderer/locale";
import { WorkbenchPanel, type WorkbenchTab } from "../src/renderer/components/WorkbenchPanel";
import { ContextPanel } from "../src/renderer/components/ContextPanel";
import { PanelLayoutActions } from "../src/renderer/components/PanelLayoutActions";
import { FilePreviewProvider, useFilePreview } from "../src/renderer/components/preview/FilePreviewContext";
import { BrowserViewHost } from "../src/renderer/components/browser/BrowserViewHost";
import { BrowserController } from "../src/renderer/browser/browser-controller";
import { useSidebarResize } from "../src/renderer/hooks/useSidebarResize";
import "../src/renderer/styles.css";
import "../src/renderer/nav-rail.css";

const fixture = (window as any).splitFixture = { mounts: {} as Record<string, number>, unmounts: {} as Record<string, number>, binds: {} as Record<string, number>, visible: [] as string[], reads: [] as string[], revision: 0 };
let gitChanged = () => {};
let resolveTerminalClose: (status: "idle" | "busy" | "unavailable") => void = () => {};
let rejectTerminalClose: () => void = () => {};
fixture.terminalCloseChecks = [];
fixture.terminalCloses = [];
fixture.closeRequests = [];
fixture.resolveTerminalClose = (status: "idle" | "busy" | "unavailable") => resolveTerminalClose(status);
fixture.rejectTerminalClose = () => rejectTerminalClose();
(window as any).vela = {
  createTerminal: async ({ id }: { id: string }) => ({ id, shell: "/bin/zsh", cwd: "/workspace" }),
  onTerminalEvent: () => () => {}, writeTerminal: () => {}, resizeTerminal: () => {},
  closeTerminal: (id: string) => fixture.terminalCloses.push(id),
  getTerminalCloseStatus: (id: string) => {
    fixture.terminalCloseChecks.push(id);
    return new Promise<"idle" | "busy" | "unavailable">((resolve, reject) => { resolveTerminalClose = resolve; rejectTerminalClose = () => reject(new Error("Process inspection unavailable")); });
  },
  onGitEvent: (fn: () => void) => { gitChanged = fn; return () => {}; }, onWorkspaceEvent: () => () => {},
  readWorkspaceFile: async (path: string) => { fixture.reads.push(path); return { path, absolutePath: `/workspace/${path}`, kind: "text", content: `// ${path} revision ${fixture.revision}\n${Array.from({ length: 90 }, (_, i) => `${path} line ${i}`).join("\n")}`, size: 300, truncated: false }; },
  listWorkspaceFiles: async () => ({ root: "/workspace", files: ["one.ts", "two.ts"] }),
};
const noop = () => {};
const command = (request: any) => { if (request.type === "bind") fixture.binds[request.tabId] = request.guestId; };
const browserTabs = ["browser-1", "browser-2"].map((id, index) => {
  const controller = new BrowserController({ tabId: id, command });
  controller.store.update({ url: `https://page-${index + 1}.example`, title: `Browser ${index + 1}`, ready: true });
  return { id, conversationId: "fixture", controller };
});
function Draft({ id }: { id: string }) {
  useEffect(() => { fixture.mounts[id] = (fixture.mounts[id] ?? 0) + 1; return () => { fixture.unmounts[id] = (fixture.unmounts[id] ?? 0) + 1; }; }, [id]);
  return <div className="split-test-draft" style={{ height: "100%", overflow: "auto", padding: 18 }}><h2>{id}</h2><textarea aria-label={`Draft ${id}`} defaultValue="" style={{ width: "90%", minHeight: 70 }} /><p>内容保持挂载，拖动只改变所在区域。</p><div style={{ height: 900 }} /></div>;
}
function Controls() {
  const preview = useFilePreview();
  fixture.openFile = (path: string) => flushSync(() => preview?.openFile(path));
  fixture.reload = () => { fixture.revision++; gitChanged(); };
  return null;
}
function Fixture() {
  const rail = new URLSearchParams(location.search).has("rail");
  const [tabs, setTabs] = useState<WorkbenchTab[]>(["A", "B", "C", "D"].map(id => ({ id, kind: "chat", label: id, conversationId: id })));
  const [active, setActive] = useState<string | null>("A"), [visible, setVisible] = useState<string[]>([]), [scope, setScope] = useState(0), [collapsed, setCollapsed] = useState(false);
  const [split, setSplit] = useState(true);
  const [contextEnabled, setContextEnabled] = useState(false), [contextCollapsed, setContextCollapsed] = useState(false);
  const [locale, setLocale] = useState<AppLocale>("zh-CN");
  fixture.setLocale = (next: AppLocale) => flushSync(() => { setActiveLocale(next); document.documentElement.lang = next; setLocale(next); });
  fixture.setSplit = (enabled: boolean) => flushSync(() => setSplit(enabled));
  const contextOpen = contextEnabled && !contextCollapsed;
  const resize = useSidebarResize(false, contextOpen, true);
  fixture.setContext = (open: boolean) => flushSync(() => { setContextEnabled(true); setContextCollapsed(!open); });
  const seq = useRef(0);
  fixture.visible = visible;
  fixture.reset = (kind = "chat") => flushSync(() => {
    setScope(n => n + 1); setCollapsed(false);
    const next: WorkbenchTab[] = kind === "browser" ? [...browserTabs.map(tab => ({ ...tab, kind: "browser" as const, label: tab.id })), { id: "A", kind: "chat", label: "A", conversationId: "A" }]
      : kind === "terminal" || kind === "terminal-only" ? [{ id: "terminal-1", kind: "terminal", sessionId: "session-1", label: "Terminal" }, ...(kind === "terminal" ? [{ id: "A", kind: "chat" as const, label: "A", conversationId: "A" }] : [])]
      : ["A", "B", "C", "D"].map(id => ({ id, kind: "chat", label: id, conversationId: id }));
    setTabs(next); setActive(next[0].id);
  });
  fixture.add = () => flushSync(() => { const id = `new-${++seq.current}`; setTabs(current => [...current, { id, kind: "chat", label: id, conversationId: id }]); setActive(id); });
  fixture.requestLateTab = () => {
    flushSync(() => setActive("late-tab"));
    setTimeout(() => setTabs(current => [...current, { id: "late-tab", kind: "chat", label: "late-tab", conversationId: "late-tab" }]), 40);
  };
  fixture.activate = (id: string) => flushSync(() => setActive(id));
  fixture.expand = () => flushSync(() => setCollapsed(false));
  return <AppLocaleProvider locale={locale}><FilePreviewProvider onOpenFile={file => {
    const tab: WorkbenchTab = { id: `file:${file.id}`, kind: "file", label: file.name, title: file.path, path: file.path };
    setTabs(current => current.some(t => t.id === tab.id) ? current : [...current, tab]); setActive(tab.id);
  }} onCloseFileTab={path => setTabs(current => current.filter(t => t.id !== `file:${path}`))}>
    <Controls /><BrowserViewHost tabs={browserTabs} activeTabId={active} visibleTabIds={visible} visible={!collapsed} hosted command={command} />
    <div className={`vela-window ${rail ? "nav-rail-layout platform-darwin" : "left-collapsed"}`} style={{ height: "100vh", display: "flex", background: rail ? "linear-gradient(135deg, #b7c7db, #dfc9b5)" : undefined, "--context-panel-overlay-width": "min(var(--sidebar-right-width), calc(100vw - 24px))" } as React.CSSProperties}>
      {rail && <div style={{ width: 306, flex: "none" }} />}
      <div className={rail ? "main-stage" : undefined} style={{ display: "flex", flex: 1, minWidth: 0 }}><div className="main-stage-pane" style={{ display: "flex", flex: 1, minWidth: 0 }}>
      <main className="main-chat-view" style={{ flex: 1, minWidth: 0 }}><header className="main-chat-header"><h2>主对话</h2></header></main>
      <WorkbenchPanel splitEnabled={split} tabs={tabs} layoutKey={String(scope)} activeTabId={active} onVisibleTabsChange={setVisible} collapsed={collapsed}
        contextOpen={contextOpen} leftOpen={rail} resize={resize} project={{ git: null, openFile: noop } as any} busy={false} execution={null} onRevise={noop} onExecutePlan={noop}
        initialDiffPath={null} initialDiffPathRequestKey={0} onShowDiff={noop} agents={[]} ensureAgentMessages={noop} onControlAgent={noop} onOpenAgent={noop}
        onNewTab={() => fixture.add()} onStartAction={noop} gitAvailable={false} onActivateTab={tab => setActive(tab.id)}
        onTabCloseRequested={tab => fixture.closeRequests.push(tab.id)}
        onCloseTab={tab => { setTabs(current => current.filter(t => t.id !== tab.id)); setActive(null); }} renderChat={tab => <Draft id={tab.id} />} />
      {contextEnabled && <ContextPanel collapsed={contextCollapsed} leftOpen={false} resize={resize} state={null} planDraft={null}
        project={{ git: null } as any} onOpenPlan={noop} onResumeGoal={noop} onOpenChanges={noop} />}
      <PanelLayoutActions platform="darwin" workbenchOpen={tabs.length > 0 && !collapsed}
        onToggleWorkbench={() => { if (tabs.length) setCollapsed(value => !value); else { setCollapsed(false); fixture.add(); } }}
        contextOpen={contextOpen} onToggleContext={contextEnabled ? () => setContextCollapsed(value => !value) : undefined} />
    </div></div></div>
  </FilePreviewProvider></AppLocaleProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
