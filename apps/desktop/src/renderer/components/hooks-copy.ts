import { localizeCopy, type AppLocale } from "@vela/shared";
const zh = {
  title: "Hooks", rules: "规则", authorization: "授权", description: "在会话、工具和提交边界执行本机命令。",
  scope: "配置范围", global: "全局", project: "项目", refresh: "重新加载", loading: "正在加载…", unavailable: "请先打开工作区。",
  config: "Hooks 配置（JSON）", schema: "version 为 1；每条规则需要 id、event 和 command。matcher 只匹配工具名，支持 * 和 ?。",
  save: "保存配置", saved: "已保存。执行前请审阅并授权当前配置。", dirty: "有未保存的修改。保存后需重新授权。",
  approve: "审阅并授权", revoke: "撤销授权", trusted: "当前配置已授权", untrusted: "尚未授权，不会执行", confirm: "确认授权本机执行", cancel: "取消",
  warning: "Hooks 是本机代码，不是系统沙箱。授权后命令可读写文件、访问网络，并读取工具参数和结果中的敏感信息；不再逐次询问。只授权你信任的命令。配置变化会使授权失效。",
  restricted: "Plan、只读子代理和只读配方阶段不执行 Hooks。全局规则先于项目规则；PostToolUse 只能观察，不能撤销已发生的操作。",
  review: "将执行以下已保存的命令", empty: "还没有规则。选择事件添加示例，或粘贴配置。", add: "添加规则", remove: "移除", enabled: "启用规则",
  invalid: "配置无效：", conflict: "操作失败。草稿已保留；请重新加载并检查当前配置。", discard: "放弃草稿并重新加载", history: "最近运行", noHistory: "还没有运行记录。", historyHint: "保留本次启动期间最近 200 条记录。Hooks 记录只存事件和耗时；返回给 Agent 的上下文和拒绝理由仍随对话保存。",
  stopTest: "撤销授权并停止试运行",
  output: "试运行返回内容（不可信数据）",
  noMatch: "没有匹配此事件和工具名的已启用规则。",
  test: "试运行", testWarning: "试运行会真实执行当前范围内匹配的命令，并传入模拟数据；不会调用工具或创建 Git 提交。命令本身仍可能产生副作用。", runTest: "确认试运行", event: "事件", tool: "模拟工具名", testPassed: "试运行通过", testDenied: "试运行被拒绝或执行失败；请查看运行记录。", toolHint: "PreToolUse / PostToolUse / PreCommit 的 matcher 使用此名称。",
  running: "运行中", allowed: "通过", denied: "拒绝", error: "失败", skipped: "已跳过", duration: "耗时", status: "状态", time: "时间", details: "规则", reason: "原因代码",
};
const en: typeof zh = {
  title: "Hooks", rules: "Rules", authorization: "Authorization", description: "Run native commands at session, tool and commit boundaries.",
  scope: "Configuration scope", global: "Global", project: "Project", refresh: "Reload", loading: "Loading…", unavailable: "Open a workspace first.",
  config: "Hooks configuration (JSON)", schema: "Use version 1. Each rule needs id, event and command. matcher matches tool names using * and ?.",
  save: "Save configuration", saved: "Saved. Review and authorize the current configuration before execution.", dirty: "Unsaved changes. Saving requires authorization again.",
  approve: "Review and authorize", revoke: "Revoke authorization", trusted: "Current configuration authorized", untrusted: "Not authorized; commands will not run", confirm: "Authorize native execution", cancel: "Cancel",
  warning: "Hooks are native code, not an OS sandbox. Once authorized, commands can modify files, access the network, and read sensitive tool arguments and results without per-run prompts. Only authorize commands you trust. Configuration changes invalidate authorization.",
  restricted: "Hooks do not run in Plan, read-only subagents or read-only recipe stages. Global rules run first. PostToolUse is observational and cannot undo completed operations.",
  review: "The following saved commands will run", empty: "No rules yet. Add an event example or paste a configuration.", add: "Add rule", remove: "Remove", enabled: "Enable rule",
  invalid: "Invalid configuration: ", conflict: "Operation failed. Your draft was kept; reload and check the current configuration.", discard: "Discard draft and reload", history: "Recent runs", noHistory: "No runs yet.", historyHint: "Keeps the latest 200 records during this app session. Hook records contain only metadata and timings; context and denial reasons sent to the agent remain in conversation history.",
  stopTest: "Revoke authorization and stop test",
  output: "Test output (untrusted data)",
  noMatch: "No enabled rule matches this event and tool name.",
  test: "Test run", testWarning: "This executes matching commands in the selected scope with synthetic data. No tool is called and no Git commit is created, but the commands themselves can still have side effects.", runTest: "Run commands now", event: "Event", tool: "Simulated tool name", testPassed: "Test run passed", testDenied: "Test run denied or failed; check recent runs.", toolHint: "PreToolUse / PostToolUse / PreCommit matchers use this name.",
  running: "Running", allowed: "Passed", denied: "Denied", error: "Failed", skipped: "Skipped", duration: "Duration", status: "Status", time: "Time", details: "Rule", reason: "Reason code",
};
export const hooksCopy = (locale: AppLocale) => localizeCopy(locale, zh, en);
