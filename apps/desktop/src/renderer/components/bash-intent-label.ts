import { tr, trf } from "../locale";
import { describeBashCommand, type BashIntent, type BashIntentKind } from "./bash-intent";

/** 一条被识别的 bash 命令在界面上的文案。 */
export interface BashIntentDisplay {
  kind: BashIntentKind;
  /** 卡片标题左侧的短标签,如「读取」。 */
  label: string;
  /** 紧凑行的动作词,如「已读取」。 */
  action: string;
  /** 主体:目录、文件或搜索词。 */
  name: string;
  /** 补充信息,如搜索范围「于 src」;没有则为空串。 */
  dir: string;
}

/** 识别 bash 命令的含义并生成文案;无法归类时返回 null,调用方照常显示原命令。 */
export function bashIntentDisplay(command: string | undefined): BashIntentDisplay | null {
  const intent = describeBashCommand(command);
  if (!intent) return null;
  const display = displayIntent(intent);
  if (!intent.more) return display;
  const more = trf("另 {0} 条", "+{0} more", intent.more);
  return { ...display, dir: [display.dir, more].filter(Boolean).join(" ") };
}

function displayIntent(intent: BashIntent): BashIntentDisplay {
  const where = intent.targets[0];
  const scope = where ? trf("于 {0}", "in {0}", where) : "";
  if (intent.kind === "list") {
    return {
      kind: "list",
      label: tr("列目录", "List"),
      action: tr("已列出目录", "Listed directory"),
      name: where ?? tr("当前目录", "current directory"),
      dir: "",
    };
  }
  if (intent.kind === "read") {
    const [first = "", ...rest] = intent.targets;
    return {
      kind: "read",
      label: tr("读取", "Read"),
      action: tr("已读取", "Read"),
      name: rest.length > 0 ? `${first} +${rest.length}` : first,
      dir: "",
    };
  }
  if (intent.kind === "search") {
    return {
      kind: "search",
      label: tr("搜索", "Search"),
      action: tr("已搜索", "Searched for"),
      name: intent.query ?? "",
      dir: scope,
    };
  }
  if (intent.kind === "script") {
    const language = intent.language ?? "";
    return {
      kind: "script",
      label: tr("脚本", "Script"),
      action: trf("已运行 {0} 脚本", "Ran {0} script", language),
      name: intent.targets[0] ?? intent.query ?? "",
      dir: "",
    };
  }
  return {
    kind: "find",
    label: tr("查找", "Find"),
    action: tr("已查找文件", "Searched files"),
    name: intent.query ?? where ?? tr("当前目录", "current directory"),
    dir: intent.query ? scope : "",
  };
}
