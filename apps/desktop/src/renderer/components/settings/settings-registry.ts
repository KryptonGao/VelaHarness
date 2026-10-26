import type { SettingsCopy } from "../settings-copy";
import { uiCopy } from "../intelligent-ui/copy";

export type SettingsPageId =
  | "appearance" | "interface" | "shortcuts" | "updates"
  | "defaults" | "display" | "skills"
  | "models" | "integrations" | "mcp" | "web" | "memory"
  | "workspace" | "archived" | "usage" | "storage" | "logs"
  | "development";

export type SettingsGroupId = "general" | "agent" | "extensions" | "data" | "development";

export interface SettingsGroup {
  id: SettingsGroupId;
  pages: readonly SettingsPageId[];
}

/** 导航顺序:先按使用意图分组,同组内由常用到少用。 */
export const settingsGroups: readonly SettingsGroup[] = [
  { id: "general", pages: ["appearance", "interface", "shortcuts", "updates"] },
  { id: "agent", pages: ["defaults", "display", "skills"] },
  { id: "extensions", pages: ["models", "integrations", "mcp", "web", "memory"] },
  { id: "data", pages: ["workspace", "archived", "usage", "storage", "logs"] },
  { id: "development", pages: ["development"] },
];

export const settingsPageIds: readonly SettingsPageId[] = settingsGroups.flatMap((group) => group.pages);

export function isSettingsPageId(value: unknown): value is SettingsPageId {
  return typeof value === "string" && (settingsPageIds as readonly string[]).includes(value);
}

export function groupOfPage(page: SettingsPageId): SettingsGroupId {
  return settingsGroups.find((group) => group.pages.includes(page))?.id ?? "general";
}

/** 这些页面自带标题栏(含刷新/添加等操作),外壳不再重复画页标题。 */
export const pagesWithOwnHeader: ReadonlySet<SettingsPageId> = new Set(["integrations", "mcp", "memory", "usage"]);

export interface SettingsEntry {
  /** 与页面里 data-setting-id 一一对应;单测会校验两边一致。 */
  id: string;
  page: SettingsPageId;
  title: (copy: SettingsCopy) => string;
  hint?: (copy: SettingsCopy) => string;
  /** 同义词与另一种语言的叫法,让中文用户搜 "theme"、英文用户搜「主题」都能命中。 */
  keywords?: { zh?: readonly string[]; en?: readonly string[] };
}

export const settingsEntries: readonly SettingsEntry[] = [
  { id: "theme", page: "appearance", title: (c) => c.appearance.theme, keywords: { zh: ["主题", "明暗", "深色模式", "浅色模式", "暗色", "跟随系统"], en: ["theme", "dark mode", "light mode", "appearance", "system"] } },
  { id: "palette", page: "appearance", title: (c) => c.appearance.palette, hint: (c) => c.appearance.paletteHint, keywords: { zh: ["配色", "颜色", "主题色", "晴空", "宣纸", "青瓷", "丁香", "海棠", "夜航", "石墨", "余烬", "森林", "潮汐", "自定义主题", "自订主题", "自定义配色"], en: ["palette", "color", "colour", "daylight", "paper", "celadon", "lilac", "blossom", "midnight", "graphite", "ember", "forest", "tide", "custom theme", "custom colors", "create theme"] } },
  { id: "file-icon-theme", page: "appearance", title: (c) => c.appearance.fileIconTheme, hint: (c) => c.appearance.fileIconThemeHint, keywords: { zh: ["文件图标", "图标主题"], en: ["file icon", "icon theme", "devicon", "material"] } },
  { id: "ui-font", page: "appearance", title: (c) => c.appearance.uiFont, hint: (c) => c.appearance.uiFontHint, keywords: { zh: ["字体", "界面字体", "明体", "衬线", "宋体", "黑体", "西文", "中文字体"], en: ["font", "typeface", "serif", "sans-serif", "mincho", "latin", "cjk", "interface font"] } },
  { id: "reply-font", page: "appearance", title: (c) => c.appearance.replyFont, hint: (c) => c.appearance.replyFontHint, keywords: { zh: ["字体", "回复字体", "明体", "衬线", "宋体", "黑体", "西文", "正文"], en: ["font", "typeface", "serif", "sans-serif", "mincho", "latin", "cjk", "reply font", "message"] } },

  { id: "language", page: "interface", title: (c) => c.appearance.language, keywords: { zh: ["语言", "中文", "英文"], en: ["language", "locale", "english", "chinese", "i18n"] } },
  { id: "sound-effects", page: "interface", title: (c) => c.appearance.soundEffects, hint: (c) => c.appearance.soundEffectsHint, keywords: { zh: ["音效", "提示音", "声音", "通知"], en: ["sound", "audio", "notification", "chime"] } },
  { id: "info-layout", page: "interface", title: (c) => c.appearance.infoLayout, hint: (c) => c.appearance.infoLayoutHint, keywords: { zh: ["信息布局", "边栏", "悬浮", "环境卡片", "上下文圆环"], en: ["layout", "floating", "sidebar", "info", "context ring"] } },
  { id: "conversation-link-target", page: "interface", title: (c) => c.appearance.conversationLinkTarget, hint: (c) => c.appearance.conversationLinkHint, keywords: { zh: ["链接", "浏览器", "内置浏览器", "系统浏览器"], en: ["link", "browser", "url", "external", "embedded"] } },
  { id: "sidebar-items", page: "interface", title: (c) => c.appearance.sidebarItems, hint: (c) => c.appearance.sidebarItemsHint, keywords: { zh: ["侧边栏", "选项卡", "定时任务", "任务配方", "新对话", "Pull Requests", "Agent 收件箱", "收件箱"], en: ["sidebar", "tabs", "pull requests", "scheduled tasks", "recipes", "new chat", "agent inbox", "inbox"] } },
  { id: "composer-layout", page: "interface", title: (c) => c.appearance.composerLayout, hint: (c) => c.appearance.composerLayoutHint, keywords: { zh: ["输入框", "布局", "胶囊", "静谧", "经典", "样式"], en: ["composer", "layout", "capsule", "calm", "classic", "input", "style"] } },
  { id: "composer-capsules", page: "interface", title: (c) => c.appearance.composerCapsules, hint: (c) => c.appearance.composerCapsulesHint, keywords: { zh: ["输入框", "胶囊", "背景"], en: ["composer", "capsule", "input", "background"] } },
  { id: "send-button-icon", page: "interface", title: (c) => c.appearance.sendButtonIcon, keywords: { zh: ["发送", "纸飞机", "箭头"], en: ["send", "paper plane", "arrow"] } },

  { id: "update-status", page: "updates", title: (c) => c.updates.title, hint: (c) => c.pages.updates.description, keywords: { zh: ["更新", "版本", "升级", "检查更新", "重启", "发布页"], en: ["update", "upgrade", "version", "check for updates", "release", "restart", "about"] } },
  { id: "update-auto", page: "updates", title: (c) => c.updates.autoTitle, hint: (c) => c.updates.autoHint, keywords: { zh: ["自动更新", "自动下载", "后台"], en: ["automatic updates", "auto update", "download", "background"] } },
  { id: "update-intro", page: "updates", title: (c) => c.updates.replayTitle, hint: (c) => c.updates.replayHint, keywords: { zh: ["介绍", "引导", "新功能", "新到港", "重看"], en: ["intro", "tour", "onboarding", "what's new", "replay"] } },

  { id: "shortcuts", page: "shortcuts", title: (c) => c.appearance.shortcuts, hint: (c) => c.appearance.shortcutsHint, keywords: { zh: ["快捷键", "热键", "按键"], en: ["shortcut", "hotkey", "keyboard", "keybinding"] } },

  { id: "default-model", page: "defaults", title: (c) => c.agent.model, hint: (c) => c.agent.modelHint, keywords: { zh: ["模型", "默认模型"], en: ["model", "default model"] } },
  { id: "default-thinking", page: "defaults", title: (c) => c.agent.thinking, hint: (c) => c.agent.thinkingHint, keywords: { zh: ["思考", "推理", "强度"], en: ["thinking", "reasoning", "effort"] } },
  { id: "new-conversation", page: "defaults", title: (c) => c.agent.newConversation, hint: (c) => c.agent.newConversationHint, keywords: { zh: ["新对话", "上次使用"], en: ["new conversation", "last used", "new chat"] } },
  { id: "instructions", page: "defaults", title: (c) => c.agent.instructions, hint: (c) => c.agent.instructionsHint, keywords: { zh: ["指令", "提示词", "系统提示", "偏好"], en: ["instructions", "prompt", "system prompt", "preferences", "custom instructions"] } },
  { id: "context-limit", page: "defaults", title: (c) => c.agent.contextLimit, hint: (c) => c.agent.contextLimitHint, keywords: { zh: ["上下文", "长度", "窗口", "压缩", "token", "K"], en: ["context", "window", "length", "compact", "compaction", "token", "limit"] } },
  { id: "task-budget", page: "defaults", title: (c) => c.agent.taskBudget, hint: (c) => c.agent.taskBudgetHint, keywords: { zh: ["用量", "上限", "预算", "额度", "时间限制", "子代理"], en: ["budget", "limit", "usage", "quota", "token limit", "time limit", "subagent"] } },
  { id: "permissions", page: "defaults", title: (c) => c.permissions.title, hint: (c) => c.permissions.note, keywords: { zh: ["权限", "沙箱", "批准", "审批", "完全访问", "每次询问", "帮我批准"], en: ["permission", "sandbox", "approval", "approve", "full access", "ask", "smart"] } },

  { id: "tool-display", page: "display", title: (c) => c.appearance.toolDisplay, hint: (c) => c.appearance.toolDisplayHint, keywords: { zh: ["工具", "工具调用", "卡片", "紧凑"], en: ["tool", "tool call", "card", "compact"] } },
  { id: "tool-fold", page: "display", title: (c) => c.appearance.toolFold, hint: (c) => c.appearance.toolFoldHint, keywords: { zh: ["折叠", "分组", "合并"], en: ["fold", "group", "collapse", "merge"] } },
  { id: "tool-icon-color", page: "display", title: (c) => c.appearance.toolIconColor, hint: (c) => c.appearance.toolIconColorHint, keywords: { zh: ["图标", "颜色", "配色", "工具"], en: ["icon", "color", "colour", "tool", "palette"] } },
  { id: "tool-process-details", page: "display", title: (c) => c.appearance.toolProcessDetails, hint: (c) => c.appearance.toolProcessDetailsHint, keywords: { zh: ["耗时", "过程", "展开", "收起"], en: ["duration", "process", "timing", "expand", "collapse"] } },
  { id: "run-view", page: "display", title: (c) => c.appearance.runView, hint: (c) => c.appearance.runViewHint, keywords: { zh: ["运行视图", "待办", "待办清单", "Todo", "状态条", "步骤"], en: ["run view", "todo", "todo list", "status", "progress", "steps"] } },
  { id: "recommended-actions", page: "display", title: (c) => c.appearance.recommendedActions, hint: (c) => c.appearance.recommendedActionsHint, keywords: { zh: ["推荐操作", "建议操作", "下一步", "后续操作", "卡片"], en: ["recommended actions", "suggested actions", "next step", "follow-up", "card"] } },
  { id: "thinking-summary", page: "display", title: (c) => c.appearance.thinkingSummary, hint: (c) => c.appearance.thinkingSummaryHint, keywords: { zh: ["思考摘要", "思考总结", "总结"], en: ["thinking summary", "summary", "summarize"] } },
  { id: "thinking-summary-model", page: "display", title: (c) => c.appearance.thinkingSummaryModel, hint: (c) => c.appearance.thinkingSummaryModelHint, keywords: { zh: ["总结模型", "摘要模型"], en: ["summary model"] } },
  { id: "thinking-summary-style", page: "display", title: (c) => c.appearance.thinkingSummaryStyle, hint: (c) => c.appearance.thinkingSummaryStyleHint, keywords: { zh: ["总结显示", "标题", "跟在思考后", "跟随回复"], en: ["summary display", "headline", "inline", "prose"] } },
  { id: "reply-animation", page: "display", title: (c) => c.appearance.replyAnimation, hint: (c) => c.appearance.replyAnimationHint, keywords: { zh: ["淡入", "弹跳", "动画", "回复", "流式", "渐显"], en: ["fade", "fade-in", "bounce", "pop", "animation", "reply", "streaming"] } },
  { id: "thinking-animation", page: "display", title: (c) => c.appearance.thinkingAnimation, hint: (c) => c.appearance.thinkingAnimationHint, keywords: { zh: ["淡入", "弹跳", "动画", "思考", "流式", "渐显"], en: ["fade", "fade-in", "bounce", "pop", "animation", "thinking", "streaming"] } },
  { id: "input-prediction", page: "display", title: (c) => c.appearance.inputPrediction, hint: (c) => c.appearance.inputPredictionHint, keywords: { zh: ["输入预测", "预测输入", "灰色", "自动补全", "联想"], en: ["input prediction", "predict", "suggestion", "autocomplete", "ghost text"] } },
  { id: "input-prediction-model", page: "display", title: (c) => c.appearance.inputPredictionModel, hint: (c) => c.appearance.inputPredictionModelHint, keywords: { zh: ["预测模型"], en: ["prediction model"] } },

  { id: "intelligent-ui", page: "display", title: () => uiCopy.setting.title(), hint: () => uiCopy.setting.description(), keywords: { zh: ["交互界面", "计算器", "对比表", "原生界面", "动态界面", "生成式界面"], en: ["intelligent ui", "interactive", "generative ui", "calculator", "interface", "visual"] } },
  { id: "intelligent-ui-apps", page: "display", title: () => uiCopy.setting.microAppsTitle(), hint: () => uiCopy.setting.microAppsDescription(), keywords: { zh: ["微应用", "小游戏", "隔离", "iframe"], en: ["micro-app", "iframe", "mini game", "isolated"] } },
  { id: "intelligent-ui-metrics", page: "display", title: () => uiCopy.setting.metricsTitle(), hint: () => uiCopy.setting.metricsDescription(), keywords: { zh: ["指标", "统计", "检查器", "观测"], en: ["metrics", "statistics", "inspector", "observability"] } },

  { id: "skills", page: "skills", title: (c) => c.agent.skills, hint: (c) => c.agent.skillsHint, keywords: { zh: ["技能", "迁移", "Codex", "Claude Code", "SKILL.md"], en: ["skill", "migrate", "codex", "claude code", "SKILL.md"] } },

  { id: "providers", page: "models", title: (c) => c.models.connected, keywords: { zh: ["提供方", "登录", "账号", "密钥", "API Key", "退出登录"], en: ["provider", "login", "account", "api key", "oauth", "logout"] } },
  { id: "model-visibility", page: "models", title: (c) => c.models.visibility, hint: (c) => c.models.visibilityHint, keywords: { zh: ["隐藏模型", "显示模型", "模型列表"], en: ["hide model", "show model", "model list", "visibility"] } },
  { id: "add-model", page: "models", title: (c) => c.models.add, keywords: { zh: ["自定义模型", "接口地址", "Ollama", "base url"], en: ["custom model", "endpoint", "ollama", "base url", "openai compatible"] } },

  { id: "integrations", page: "integrations", title: (c) => c.pages.integrations.label, hint: (c) => c.pages.integrations.description, keywords: { zh: ["集成", "插件", "连接", "Notion"], en: ["integration", "plugin", "connect", "notion"] } },

  { id: "mcp-servers", page: "mcp", title: (c) => c.mcp.title, hint: (c) => c.mcp.hint, keywords: { zh: ["MCP", "服务器", "添加服务器", "工具"], en: ["mcp", "server", "model context protocol", "tools", "add server"] } },
  { id: "mcp-trust", page: "mcp", title: (c) => c.mcp.trustTitle, hint: (c) => c.mcp.trustHint, keywords: { zh: ["信任", "项目信任"], en: ["trust", "project trust"] } },
  { id: "mcp-import", page: "mcp", title: (c) => c.mcp.importTitle, hint: (c) => c.mcp.importHint, keywords: { zh: ["导入", "JSON", "mcpServers"], en: ["import", "json", "mcpServers"] } },

  { id: "web-tools-enabled", page: "web", title: (c) => c.webTools.enabledLabel, hint: (c) => c.webTools.hint, keywords: { zh: ["网页", "搜索", "抓取", "联网", "web_search", "web_fetch", "DeepSeek"], en: ["web", "search", "fetch", "browse", "internet", "web_search", "web_fetch", "deepseek"] } },
  { id: "web-tools-providers", page: "web", title: (c) => c.webTools.providersTitle, hint: (c) => c.webTools.keyHint, keywords: { zh: ["提供商", "密钥", "自定义接口", "API 密钥", "Tavily", "搜索接口"], en: ["provider", "api key", "custom endpoint", "tavily", "search api"] } },
  { id: "memory-enabled", page: "memory", title: (c) => c.memory.enabledLabel, hint: (c) => c.memory.enabledHint, keywords: { zh: ["记忆", "全局记忆", "项目记忆", "MEMORY.md"], en: ["memory", "global memory", "project memory", "MEMORY.md"] } },

  { id: "workspace-current", page: "workspace", title: (c) => c.workspace.current, keywords: { zh: ["工作区", "文件夹", "打开文件夹", "关闭工作区"], en: ["workspace", "folder", "project", "open folder"] } },
  { id: "workspace-recent", page: "workspace", title: (c) => c.workspace.recent, keywords: { zh: ["最近使用", "最近"], en: ["recent", "history"] } },
  { id: "workspace-environment", page: "workspace", title: (c) => c.workspace.environment, keywords: { zh: ["执行环境", "本地", "工作树", "沙箱", "远程"], en: ["environment", "local", "worktree", "sandbox", "remote"] } },

  { id: "archived", page: "archived", title: (c) => c.archived.title, hint: (c) => c.archived.hint, keywords: { zh: ["归档", "取消归档", "恢复对话"], en: ["archive", "unarchive", "restore chat"] } },

  { id: "usage", page: "usage", title: (c) => c.pages.usage.label, hint: (c) => c.pages.usage.description, keywords: { zh: ["用量", "Token", "统计", "请求"], en: ["usage", "tokens", "statistics", "requests", "cost"] } },
  { id: "model-pricing", page: "usage", title: (c) => c.modelPricing.title, hint: (c) => c.modelPricing.hint, keywords: { zh: ["价格", "费用", "成本", "计价", "人民币", "美元", "缓存写入", "缓存读取"], en: ["price", "pricing", "cost", "billing", "cny", "usd", "cache write", "cache read", "per million"] } },

  { id: "checkpoint-storage", page: "storage", title: (c) => c.storage.checkpointsTitle, hint: (c) => c.storage.checkpointsHint, keywords: { zh: ["检查点", "磁盘", "空间", "占用", "清理", "缓存", "存储"], en: ["checkpoint", "disk", "space", "storage", "clean", "cleanup", "cache", "size"] } },

  { id: "log-level", page: "logs", title: (c) => c.logs.levelTitle, hint: (c) => c.logs.levelHint, keywords: { zh: ["日志", "调试", "级别"], en: ["log", "debug", "level", "verbose"] } },
  { id: "log-folder", page: "logs", title: (c) => c.logs.folderTitle, hint: (c) => c.logs.folderHint, keywords: { zh: ["日志位置", "日志文件夹"], en: ["log folder", "log location"] } },
  { id: "log-export", page: "logs", title: (c) => c.logs.exportTitle, hint: (c) => c.logs.exportHint, keywords: { zh: ["诊断", "导出", "反馈", "Trace"], en: ["diagnostics", "export", "bug report", "trace", "zip"] } },

  { id: "dev-sync", page: "development", title: (c) => c.development.title, hint: (c) => c.development.hint, keywords: { zh: ["同步", "正式版", "会话", "模型", "技能", "记忆", "预览"], en: ["sync", "production", "conversations", "models", "skills", "mcp", "memory", "preview"] } },
  { id: "dev-sync-history", page: "development", title: (c) => c.development.historyTitle, hint: (c) => c.development.historyHint, keywords: { zh: ["撤销", "回滚", "批次", "同步记录"], en: ["undo", "rollback", "batch", "history"] } },
  { id: "dev-tools", page: "development", title: (c) => c.development.toolsTitle, hint: (c) => c.development.toolsHint, keywords: { zh: ["DevTools", "开发者工具", "重新加载", "重启", "main process", "主进程", "引导", "OnBoarding", "新手引导"], en: ["devtools", "developer tools", "reload", "restart", "main process", "onboarding", "welcome", "first run"] } },
  { id: "dev-info", page: "development", title: (c) => c.development.infoTitle, hint: (c) => c.development.infoHint, keywords: { zh: ["版本", "提交", "commit", "Electron", "Node", "issue"], en: ["version", "commit", "hash", "electron", "node", "issue"] } },
];
