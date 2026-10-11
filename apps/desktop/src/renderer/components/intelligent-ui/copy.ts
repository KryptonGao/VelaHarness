import type { SandboxStopReason, UiEvalErrorCode, UiInputError, UiRejectReason, UiSourceMessage } from "@vela/shared";
import { tr, trf } from "../../locale";

/** Intelligent UI 的界面文案。中文原文是查找键，zh-TW/ja/ko 译文在 packages/shared/src/i18n-messages。 */
export const uiCopy = {
  region: () => tr("交互式界面", "Interactive interface"),
  building: () => tr("正在生成界面…", "Building interface…"),
  incomplete: () => tr("界面生成未完成，下面只显示已验证的部分。", "The interface was cut short. Only the verified parts are shown."),
  invalidTitle: () => tr("无法显示这个界面", "This interface can't be shown"),
  invalidHint: () => tr("内容不符合安全格式，已隐藏。可以查看原始文本。", "The content doesn't match the safe format and was hidden. You can view the source."),
  viewSource: () => tr("查看原始文本", "View source"),
  hideSource: () => tr("隐藏原始文本", "Hide source"),
  copyText: () => tr("复制文字", "Copy as text"),
  copied: () => tr("已复制", "Copied"),
  copyFailed: () => tr("复制失败", "Copy failed"),
  unsupported: () => tr("不支持的组件", "Unsupported component"),
  cannotShow: () => tr("无法显示此组件", "This component can't be shown"),
  source: () => tr("来源", "Source"),
  unverified: () => tr("未验证", "unverified"),
  noData: () => tr("暂无数据", "No data"),
  search: () => tr("搜索", "Search"),
  filter: () => tr("筛选", "Filter"),
  all: () => tr("全部", "All"),
  expand: () => tr("展开", "Expand"),
  collapse: () => tr("收起", "Collapse"),
  noRows: () => tr("没有匹配的行", "No matching rows"),
  sortBy: (label: string) => trf("按「{0}」排序", "Sort by {0}", label),
  sortedAsc: () => tr("升序", "ascending"),
  sortedDesc: () => tr("降序", "descending"),
  sendToAgent: () => tr("将发送给 Agent", "Send to the agent"),
  willSend: () => tr("将发送以下内容：", "This will be sent:"),
  send: () => tr("发送", "Send"),
  queueNote: () => tr("Agent 正在运行，这条消息会排队等待。", "The agent is running, so this message will be queued."),
  cancel: () => tr("取消", "Cancel"),
  unavailable: () => tr("当前不能发送消息", "Messages can't be sent right now"),
  openLink: (url: string) => trf("将在浏览器中打开：{0}", "This will open in the browser: {0}", url),
  open: () => tr("打开", "Open"),
  statusLoading: () => tr("加载中", "Loading"),
  statusStale: () => tr("可能已过期", "May be out of date"),
  statusError: () => tr("获取失败", "Failed to load"),
  statusEmpty: () => tr("没有内容", "Nothing here"),
  required: () => tr("必填", "Required"),
  inputError: (code: UiInputError, bound: number | undefined): string => {
    switch (code) {
      case "required": return tr("请填写这一项", "This is required");
      case "not_a_number": return tr("请输入有效数字", "Enter a valid number");
      case "below_min": return trf("不能小于 {0}", "Must be at least {0}", bound ?? "");
      case "above_max": return trf("不能大于 {0}", "Must be at most {0}", bound ?? "");
      case "too_long": return tr("内容太长", "Too long");
      case "not_an_option": return tr("请选择有效的选项", "Choose a valid option");
      default: return tr("输入无效", "Invalid input");
    }
  },
  evalError: (code: UiEvalErrorCode): string => {
    switch (code) {
      case "division_by_zero": return tr("除数不能为零", "Can't divide by zero");
      case "not_finite": return tr("结果不是有限数", "The result isn't a finite number");
      case "invalid_input": return tr("请先修正输入", "Fix the input first");
      case "pending_ref": return tr("等待数据", "Waiting for data");
      case "type_mismatch": return tr("数据类型不匹配", "Values don't match");
      case "source_pending": return tr("数据加载中", "Data is loading");
      case "source_failed": return tr("数据获取失败", "The data couldn't be loaded");
      case "source_empty": return tr("数据源没有内容", "The data source is empty");
      default: return tr("无法计算", "Can't calculate");
    }
  },
  reason: (reason: UiRejectReason | null): string => {
    switch (reason) {
      case "unsupported_version": return tr("不支持的界面版本", "Unsupported interface version");
      case "limit_nodes": case "limit_depth": case "limit_states": case "limit_derived": case "limit_options": case "limit_bytes": case "limit_line":
        return tr("界面超出大小限制", "The interface is over the size limit");
      case "forbidden_key": return tr("包含不允许的字段", "Contains a forbidden field");
      case "limit_sources": return tr("数据源数量超出限制", "Too many data sources");
      case "bad_source": case "unknown_source": return tr("数据源声明不正确", "A data source is declared incorrectly");
      case "bad_reference": case "cyclic_reference": case "bad_binding": return tr("引用或绑定不正确", "A reference or binding is wrong");
      case "bad_json": case "bad_op": case "unknown_op": return tr("格式不正确", "The format is wrong");
      default: return tr("结构不正确", "The structure is wrong");
    }
  },
  cannotSave: () => tr("无法保存这项设置，已恢复原来的选择。", "Couldn't save this setting, so the previous choice was restored."),
  progress: (value: string, max: string) => trf("{0} / {1}", "{0} / {1}", value, max),
  yes: () => tr("是", "Yes"),
  no: () => tr("否", "No"),
  // ----- 图表、示意图（IUI-10） -----
  dataTable: () => tr("查看数据表", "View data table"),
  copyData: () => tr("复制数据", "Copy data"),
  copyTable: () => tr("复制表格", "Copy table"),
  saveImage: () => tr("保存图片", "Save image"),
  imageSaved: () => tr("已保存", "Saved"),
  imageFailed: () => tr("保存失败", "Couldn't save"),
  legend: () => tr("图例", "Legend"),
  barChart: () => tr("柱状图", "Bar chart"),
  lineChart: () => tr("折线图", "Line chart"),
  pieChart: () => tr("饼图", "Pie chart"),
  chartRole: () => tr("图表", "chart"),
  chartSummary: (points: number, series: number) => trf("{0} 个数据点，{1} 个系列。用方向键查看数据点。", "{0} data points in {1} series. Use the arrow keys to move between points.", points, series),
  pieSummary: (slices: number) => trf("{0} 个扇区。用方向键切换扇区。", "{0} slices. Use the arrow keys to move between slices.", slices),
  pieSkipped: (count: number) => trf("有 {0} 个扇区的值不是非负数，已忽略。", "{0} slice(s) were ignored because their values aren't non-negative numbers.", count),
  dragHint: () => tr("拖动数据点，或选中后用上下方向键调整（Shift 加大步长）。", "Drag a point, or select it and use the up/down arrow keys (Shift for bigger steps)."),
  category: () => tr("类别", "Category"),
  value: () => tr("数值", "Value"),
  diagramParts: () => tr("示意图中的部分", "Parts of the diagram"),
  mediaImageMissing: () => tr("没有连接图片服务，这里只显示说明文字。", "No image service is connected, so only the description is shown."),
  mediaMapMissing: () => tr("没有连接地图服务，这里只显示说明文字。", "No map service is connected, so only the description is shown."),
  // ----- 数据来源（IUI-11） -----
  dataFrom: () => tr("数据", "Data"),
  recordId: () => tr("记录", "Record"),
  unknownTime: () => tr("时间未知", "unknown time"),
  refresh: () => tr("刷新", "Refresh"),
  truncated: () => tr("结果被截断", "Result was truncated"),
  willSendRefresh: () => tr("将请 Agent 重新获取数据：", "This asks the agent to fetch the data again:"),
  willSendToolRequest: () => tr("将建议 Agent 运行一个工具（不是授权）：", "This suggests a tool to the agent (it isn't an approval):"),
  willSendContinue: () => tr("将把当前设置交给 Agent：", "This hands the current settings to the agent:"),
  continueWithSettings: () => tr("按当前设置继续", "Continue with these settings"),
  sourceMessage: (message: UiSourceMessage | null, detail: string | null): string => {
    switch (message) {
      case "not_found": return tr("会话里没有找到对应的工具结果。可以请 Agent 重新运行它。", "No matching tool result was found in this conversation. Ask the agent to run it again.");
      case "tool_error": return detail ? trf("工具运行失败：{0}", "The tool failed: {0}", detail) : tr("工具运行失败。", "The tool failed.");
      case "truncated": return tr("工具结果被截断，不能当作完整数据。", "The tool result was truncated, so it can't be treated as complete data.");
      case "not_json": return tr("工具结果不是有效的 JSON。", "The tool result isn't valid JSON.");
      case "bad_path": return tr("在工具结果里找不到声明的数据位置。", "The declared data location isn't in the tool result.");
      case "too_large": return tr("工具结果太大，无法显示。", "The tool result is too large to show.");
      case "no_output": return tr("工具没有输出内容。", "The tool produced no output.");
      case "bad_csv": return tr("工具结果不是有效的 CSV。", "The tool result isn't valid CSV.");
      default: return tr("没有可显示的数据。", "There's no data to show.");
    }
  },
  // ----- 时间轴、行程、差异（IUI-15） -----
  timelineDone: () => tr("已完成", "Done"),
  timelineCurrent: () => tr("进行中", "In progress"),
  timelineUpcoming: () => tr("待进行", "Upcoming"),
  timelineBlocked: () => tr("受阻", "Blocked"),
  coordsFromModel: () => tr("坐标由模型给出", "coordinates given by the model"),
  showPlot: () => tr("显示位置示意图", "Show location sketch"),
  hidePlot: () => tr("隐藏位置示意图", "Hide location sketch"),
  plotLabel: () => tr("地点位置示意图", "Sketch of the locations"),
  plotNote: () => tr("这只是示意图，不是地图：位置只根据模型给出的坐标绘制，没有底图，也不保证准确。", "This is a sketch, not a map: positions use only coordinates the model gave, with no base map, and aren't guaranteed to be accurate."),
  diffAdded: (count: number) => trf("新增 {0} 行", "{0} lines added", count),
  diffRemoved: (count: number) => trf("删除 {0} 行", "{0} lines removed", count),
  diffRegion: () => tr("差异内容", "Diff"),
  diffAddedLine: () => tr("新增：", "Added:"),
  diffRemovedLine: () => tr("删除：", "Removed:"),
  diffTruncated: () => tr("差异太长，只显示前面一部分。", "The diff is long, so only the first part is shown."),
  copyDiff: () => tr("复制差异", "Copy diff"),
  // ----- 沙盒微应用（IUI-14） -----
  appBadge: () => tr("沙盒微应用", "Sandboxed micro-app"),
  appDefaultTitle: () => tr("微应用", "Micro-app"),
  appRegion: (title: string) => trf("沙盒微应用：{0}", "Sandboxed micro-app: {0}", title),
  appRun: () => tr("运行", "Run"),
  appRunAgain: () => tr("重新运行", "Run again"),
  appStop: () => tr("停止", "Stop"),
  appDisabled: () => tr("微应用已关闭，没有运行。", "Micro-apps are turned off, so this one isn't running."),
  appDisabledHint: () => tr("可以在设置 → 交互式界面里打开。打开前请先阅读那里的风险说明。", "You can turn them on in Settings → Interactive interface. Read the risk note there first."),
  appIncomplete: () => tr("微应用的代码没有生成完整，不能运行。", "The micro-app's code is incomplete, so it can't run."),
  appTooLarge: () => tr("微应用超过大小限制，已隐藏。", "The micro-app is over the size limit and was hidden."),
  appUnsupported: () => tr("微应用格式不正确，已隐藏。", "The micro-app's format is wrong, so it was hidden."),
  appWarning: () => tr("这是模型写的代码，只会在隔离的沙盒里运行：不能联网、不能读写文件、碰不到 Vela 的任何数据。它想发消息或复制文字时，会先问你。", "This is code written by the model. It runs only in an isolated sandbox: no network, no files, no access to Vela's data. If it wants to send a message or copy text, it asks you first."),
  appLimit: (max: number) => trf("最多同时运行 {0} 个微应用，请先停止一个。", "At most {0} micro-apps can run at once. Stop one first.", max),
  appAsk: () => tr("微应用请求", "Micro-app request"),
  appAskSubmit: (title: string) => trf("「{0}」想把下面的内容发给 Agent：", "“{0}” wants to send this to the agent:", title),
  appAskCopy: (title: string) => trf("「{0}」想把下面的文字复制到剪贴板：", "“{0}” wants to copy this text to the clipboard:", title),
  deny: () => tr("拒绝", "Deny"),
  appStopReason: (reason: SandboxStopReason): string => {
    switch (reason) {
      case "unresponsive": return tr("微应用没有响应，已停止。", "The micro-app stopped responding and was stopped.");
      case "errors": return tr("微应用错误太多，已停止。", "The micro-app raised too many errors and was stopped.");
      case "timeout": return tr("微应用运行时间过长，已停止。", "The micro-app ran too long and was stopped.");
      case "limit": return tr("微应用超出资源限制，已停止。", "The micro-app went over a resource limit and was stopped.");
      default: return tr("微应用已停止。", "The micro-app was stopped.");
    }
  },
  // ----- 开发检查器（IUI-13） -----
  inspector: () => tr("开发检查器", "Inspector"),
  inspectorAst: () => tr("结构", "Structure"),
  inspectorEvents: () => tr("事件", "Events"),
  inspectorState: () => tr("状态", "State"),
  inspectorSources: () => tr("数据源", "Sources"),
  inspectorRejections: () => tr("拒绝原因", "Rejections"),
  inspectorEmpty: () => tr("（没有内容）", "(nothing here)"),
  inspectorNone: () => tr("没有被拒绝的内容。", "Nothing was rejected."),
  inspectorTruncated: () => tr("已截断", "truncated"),
  inspectorLocal: () => tr("只在本机内存里显示，不会上传。", "Shown from local memory only. Nothing is uploaded."),
  setting: {
    title: () => tr("交互式界面", "Interactive interface"),
    description: () => tr("让 Agent 在合适时用计算器、对比表等原生界面回答，而不是只给文字。界面不会运行代码，也不会自动执行任何操作。", "Let the agent answer with native calculators, comparison tables and similar views when they help. Interfaces never run code or take actions on their own."),
    auto: () => tr("自动", "Auto"),
    autoHint: () => tr("只在界面比文字更好用时生成", "Only when an interface beats plain text"),
    textOnly: () => tr("仅文字", "Text only"),
    textOnlyHint: () => tr("不生成交互界面", "Never generate interfaces"),
    visualFirst: () => tr("偏向可视化", "Visual first"),
    visualFirstHint: () => tr("比较、计算类问题优先用界面", "Prefer interfaces for comparisons and calculators"),
    microAppsTitle: () => tr("微应用（高级）", "Micro-apps (advanced)"),
    microAppsDescription: () => tr("允许 Agent 写一小段 HTML/JavaScript，在隔离的沙盒里运行（例如小游戏、可视化实验）。默认关闭。", "Let the agent write a small piece of HTML/JavaScript that runs in an isolated sandbox (for example a mini game or a visual experiment). Off by default."),
    microAppsWarning: () => tr("风险提示：这是模型写的代码。沙盒不能联网、不能读写文件、不能访问 Vela 的数据，每次运行都要你点「运行」，发消息或复制文字都要你逐次确认；但它仍可能占用 CPU 或显示误导性内容。不熟悉时请保持关闭。", "Risk note: this is code written by the model. The sandbox has no network, no file access and no access to Vela's data; each run needs your click on Run, and sending a message or copying text needs your confirmation every time. It can still use CPU or show misleading content. Keep it off if you're unsure."),
    microAppsOn: () => tr("开启", "On"),
    microAppsOff: () => tr("关闭", "Off"),
    metricsTitle: () => tr("本地指标", "Local metrics"),
    metricsDescription: () => tr("只统计次数和耗时，不含界面内容或你输入的值；只保存在本机，不会上传。", "Counts and timings only: no interface content or values you typed. Stored on this device and never uploaded."),
    metricsEmpty: () => tr("还没有数据。让 Agent 生成几次界面之后再来看。", "No data yet. Check back after the agent has generated some interfaces."),
    metricsUiRatio: () => tr("含界面的回复", "Replies with an interface"),
    metricsCommit: () => tr("界面成功率", "Interface success rate"),
    metricsFirstNode: () => tr("首个组件出现耗时（中位数）", "Time to first component (median)"),
    metricsAverage: () => tr("平均组件 / 状态数", "Average components / states"),
    metricsDegraded: () => tr("降级与失败", "Degraded or failed"),
    metricsApps: () => tr("微应用运行次数", "Micro-app runs"),
    metricsReset: () => tr("清除指标", "Clear metrics"),
    inspectorToggle: () => tr("在界面下方显示开发检查器", "Show the inspector under interfaces"),
    inspectorToggleHint: () => tr("查看结构、事件时间线、状态、数据源和拒绝原因，仅用于排查问题。", "Shows the structure, event timeline, state, sources and rejection reasons, for troubleshooting only."),
  },
};
