import { app, BrowserWindow, Menu, shell, type MenuItemConstructorOptions } from "electron";
import { IpcChannel, isMenuAction, localizeZh, type AppLocale, type MenuAction } from "@vela/shared";
import desktopPackage from "../../package.json";
import { restoreDefaultWindowSize } from "./window-size";

const repoUrl = "https://github.com/KryptonGao/VelaHarness";
let activeLocale: AppLocale = "zh-CN";
let diagnostics: DiagnosticsMenuActions | null = null;
let checkForUpdates: (() => void) | null = null;

export interface DiagnosticsMenuActions {
  exportLogs(): void;
  openLogsFolder(): void;
}

function text(chinese: string, english: string): string {
  return localizeZh(activeLocale, chinese, english);
}

export function getApplicationLocale(): AppLocale {
  return activeLocale;
}

export function setApplicationLocale(locale: AppLocale): void {
  activeLocale = locale;
  installApplicationMenu();
  app.setAboutPanelOptions({
    applicationName: "Vela",
    applicationVersion: desktopPackage.shortVersion ?? app.getVersion(),
    credits: text("在你选定的代码仓库中工作的桌面 AI 编程助手。", "A desktop AI coding assistant that works in the code repository you choose."),
  });
}

/** 帮助菜单里的日志入口直接在主进程执行,不经渲染层。 */
export function setDiagnosticsMenuActions(actions: DiagnosticsMenuActions): void {
  diagnostics = actions;
  installApplicationMenu();
}

/** 「检查更新…」由主进程直接处理并用系统对话框反馈。 */
export function setUpdateMenuAction(action: () => void): void {
  checkForUpdates = action;
  installApplicationMenu();
}

/** 渲染层同步过来的加速键;null 表示还没收到,沿用内置默认值。 */
let customAccelerators: Partial<Record<MenuAction, string>> | null = null;
const ACCELERATOR_PATTERN = /^[A-Za-z0-9+\[\],.;'`\\=\/-]{1,40}$/;

/** 用户在设置里改了快捷键,或正在录入新快捷键(空表)时,重建菜单。 */
export function setMenuAccelerators(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const next: Partial<Record<MenuAction, string>> = {};
  for (const [action, accelerator] of Object.entries(value)) {
    if (isMenuAction(action) && typeof accelerator === "string" && ACCELERATOR_PATTERN.test(accelerator)) next[action] = accelerator;
  }
  customAccelerators = next;
  installApplicationMenu();
}

const defaultAccelerators: Partial<Record<MenuAction, string>> = {
  "new-chat": "CmdOrCtrl+N",
  "new-tab": "CmdOrCtrl+T",
  "toggle-settings": "CmdOrCtrl+,",
  "toggle-sidebar": "CmdOrCtrl+B",
  "toggle-info": "CmdOrCtrl+J",
  "archive-chat": "CmdOrCtrl+Shift+A",
  "side-chat": "CmdOrCtrl+Alt+S",
  "next-tab": "CmdOrCtrl+Shift+]",
  "prev-tab": "CmdOrCtrl+Shift+[",
  "next-chat": "CmdOrCtrl+Alt+]",
  "prev-chat": "CmdOrCtrl+Alt+[",
  "next-attention-chat": "CmdOrCtrl+Alt+A",
  "open-changes": "Ctrl+Shift+G",
  "open-files": "CmdOrCtrl+Shift+E",
  // macOS 上才注册返回/前进;其余平台的 Alt+←/→ 在输入框里要留给文本编辑,由渲染层按焦点处理。
  ...(process.platform === "darwin" ? { "go-back": "Cmd+[", "go-forward": "Cmd+]" } : {}),
};

function accelerator(action: MenuAction): { accelerator?: string } {
  const value = (customAccelerators ?? defaultAccelerators)[action];
  return value ? { accelerator: value } : {};
}

function sendMenuAction(action: MenuAction): void {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  win?.webContents.send(IpcChannel.appMenuAction, action);
}

/**
 * 自建应用菜单:顶部应用菜单带程序名,操作走标准 role,业务动作经 IPC 发给渲染层。
 * macOS 上首个菜单的标题由系统按应用名强制显示,这里仍给出 label 保证其他平台正确。
 */
export function installApplicationMenu(): void {
  const name = app.name;
  const isMac = process.platform === "darwin";

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: name,
            submenu: [
              { role: "about", label: text(`关于 ${name}`, `About ${name}`) },
              ...(checkForUpdates ? [{ label: text("检查更新…", "Check for Updates…"), click: () => checkForUpdates?.() } satisfies MenuItemConstructorOptions] : []),
              { type: "separator" },
              { role: "services", label: text("服务", "Services") },
              { type: "separator" },
              { role: "hide", label: text(`隐藏 ${name}`, `Hide ${name}`) },
              { role: "hideOthers", label: text("隐藏其他", "Hide Others") },
              { role: "unhide", label: text("全部显示", "Show All") },
              { type: "separator" },
              { role: "quit", label: text(`退出 ${name}`, `Quit ${name}`) },
            ],
          } satisfies MenuItemConstructorOptions,
        ]
      : []),
    {
      label: text("文件", "File"),
      submenu: [
        { label: text("新建会话", "New Chat"), ...accelerator("new-chat"), click: () => sendMenuAction("new-chat") },
        { label: text("新建标签页", "New Tab"), ...accelerator("new-tab"), click: () => sendMenuAction("new-tab") },
        { label: text("归档聊天", "Archive Chat"), ...accelerator("archive-chat"), click: () => sendMenuAction("archive-chat") },
        { type: "separator" },
        { label: text("设置…", "Settings…"), ...accelerator("toggle-settings"), click: () => sendMenuAction("toggle-settings") },
        { type: "separator" },
        { role: "close", label: text("关闭窗口", "Close Window") },
      ],
    },
    {
      label: text("编辑", "Edit"),
      submenu: [
        { role: "undo", label: text("撤销", "Undo") },
        { role: "redo", label: text("重做", "Redo") },
        { type: "separator" },
        { role: "cut", label: text("剪切", "Cut") },
        { role: "copy", label: text("拷贝", "Copy") },
        { role: "paste", label: text("粘贴", "Paste") },
        { role: "selectAll", label: text("全选", "Select All") },
      ],
    },
    {
      label: text("显示", "View"),
      submenu: [
        { label: text("切换侧边栏", "Toggle Sidebar"), ...accelerator("toggle-sidebar"), click: () => sendMenuAction("toggle-sidebar") },
        { label: text("切换信息面板", "Toggle Info Panel"), ...accelerator("toggle-info"), click: () => sendMenuAction("toggle-info") },
        { type: "separator" },
        { role: "reload", label: text("重新加载", "Reload") },
        { role: "forceReload", label: text("强制重新加载", "Force Reload") },
        { role: "toggleDevTools", label: text("开发者工具", "Developer Tools") },
        { type: "separator" },
        { role: "resetZoom", label: text("实际大小", "Actual Size") },
        { role: "zoomIn", label: text("放大", "Zoom In") },
        { role: "zoomOut", label: text("缩小", "Zoom Out") },
        { type: "separator" },
        { role: "togglefullscreen", label: text("进入全屏", "Toggle Full Screen") },
      ],
    },
    {
      label: text("前往", "Go"),
      submenu: [
        { label: text("返回", "Back"), ...accelerator("go-back"), click: () => sendMenuAction("go-back") },
        { label: text("前进", "Forward"), ...accelerator("go-forward"), click: () => sendMenuAction("go-forward") },
        { type: "separator" },
        { label: text("下一个聊天", "Next Chat"), ...accelerator("next-chat"), click: () => sendMenuAction("next-chat") },
        { label: text("上一个聊天", "Previous Chat"), ...accelerator("prev-chat"), click: () => sendMenuAction("prev-chat") },
        { label: text("下一个需关注的聊天", "Next Chat Needing Attention"), ...accelerator("next-attention-chat"), click: () => sendMenuAction("next-attention-chat") },
        { type: "separator" },
        { label: text("主页", "Home"), click: () => sendMenuAction("go-home") },
        { label: text("定时任务", "Scheduled Tasks"), click: () => sendMenuAction("open-scheduled-tasks") },
        { label: text("任务配方", "Task Recipes"), click: () => sendMenuAction("open-recipes") },
        { label: text("Agent 收件箱", "Agent Inbox"), click: () => sendMenuAction("open-agent-inbox") },
        { label: "Pull Request", click: () => sendMenuAction("open-pr-inbox") },
      ],
    },
    {
      label: text("工作台", "Workbench"),
      submenu: [
        { label: text("下一个标签页", "Next Tab"), ...accelerator("next-tab"), click: () => sendMenuAction("next-tab") },
        { label: text("上一个标签页", "Previous Tab"), ...accelerator("prev-tab"), click: () => sendMenuAction("prev-tab") },
        { type: "separator" },
        { label: text("终端", "Terminal"), ...accelerator("open-terminal"), click: () => sendMenuAction("open-terminal") },
        { label: text("文件", "Files"), ...accelerator("open-files"), click: () => sendMenuAction("open-files") },
        { label: text("浏览器", "Browser"), ...accelerator("open-browser"), click: () => sendMenuAction("open-browser") },
        { label: text("变更", "Changes"), ...accelerator("open-changes"), click: () => sendMenuAction("open-changes") },
        { label: text("侧边聊天", "Side Chat"), ...accelerator("side-chat"), click: () => sendMenuAction("side-chat") },
      ],
    },
    {
      role: "windowMenu", label: text("窗口", "Window"),
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { type: "separator" },
        {
          label: text("恢复默认窗口大小", "Restore Default Window Size"),
          accelerator: "CmdOrCtrl+Alt+0",
          click: (_item, win) => { if (win instanceof BrowserWindow) restoreDefaultWindowSize(win); },
        },
        ...(isMac
          ? [{ type: "separator" }, { role: "front" }] satisfies MenuItemConstructorOptions[]
          : [{ role: "close" }] satisfies MenuItemConstructorOptions[]),
      ],
    },
    {
      label: text("帮助", "Help"),
      submenu: [
        ...(isMac
          ? []
          : [{ role: "about", label: text(`关于 ${name}`, `About ${name}`) } satisfies MenuItemConstructorOptions]),
        ...(checkForUpdates && !isMac
          ? [{ label: text("检查更新…", "Check for Updates…"), click: () => checkForUpdates?.() } satisfies MenuItemConstructorOptions]
          : []),
        {
          label: text("项目主页", "Project Website"),
          click: () => void shell.openExternal(repoUrl),
        },
        ...(diagnostics
          ? [
              { type: "separator" },
              { label: text("导出诊断日志…", "Export Diagnostic Logs…"), click: () => diagnostics?.exportLogs() },
              { label: text("打开日志文件夹", "Open Logs Folder"), click: () => diagnostics?.openLogsFolder() },
            ] satisfies MenuItemConstructorOptions[]
          : []),
      ],
    },
  ];

  try {
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  } catch (error) {
    // 个别加速键 Electron 不认时,退回内置默认值,保证菜单始终可用。
    if (customAccelerators === null) throw error;
    customAccelerators = null;
    installApplicationMenu();
  }
}
