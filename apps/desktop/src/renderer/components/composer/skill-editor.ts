import { tr } from "../../locale";
import { applySkillPick, skillTitle, slashTokenAt, type SlashToken } from "./skill-picker";

/** 输入框里 Skill 芯片携带的技能名称。 */
export const skillAttr = "data-skill";

/** 光标所在的 `/查询`，以及它所在的文本节点。 */
export interface EditorSlash extends SlashToken {
  node: Text;
}

export interface ChipIcons {
  skill: Node;
  close: Node;
}

/**
 * 把输入框内容收成发送用的文本：Skill 芯片写成 `/skill:名称`，位置不变。
 * 名称里有空白时展开会截断，这种芯片只在界面上存在，不进文本。
 * 芯片前后保证有空白，Pi 才能把它认成命令。
 */
export function serializeEditor(root: HTMLElement): string {
  let out = "";
  let needSpace = false;
  const append = (text: string) => {
    if (!text) return;
    if (needSpace && !/^\s/.test(text)) out += " ";
    needSpace = false;
    out += text;
  };
  const walk = (parent: Node) => {
    for (const child of Array.from(parent.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        append((child.nodeValue ?? "").replace(/ /g, " "));
        continue;
      }
      if (!(child instanceof HTMLElement)) continue;
      const name = child.getAttribute(skillAttr);
      if (name !== null) {
        if (/\s/.test(name)) continue;
        if (out && !/\s$/.test(out)) out += " ";
        out += `/skill:${name}`;
        needSpace = true;
      } else if (child.tagName === "BR") {
        append("\n");
      } else {
        if ((child.tagName === "DIV" || child.tagName === "P") && out && !out.endsWith("\n")) append("\n");
        walk(child);
      }
    }
  };
  walk(root);
  return out;
}

/** 光标紧贴在文本节点内的 `/查询` 上时返回它。 */
export function editorSlash(root: HTMLElement): EditorSlash | null {
  const selection = window.getSelection();
  const node = selection?.anchorNode;
  if (!selection || !selection.isCollapsed || !node || node.nodeType !== Node.TEXT_NODE || !root.contains(node)) {
    return null;
  }
  const token = slashTokenAt(node.nodeValue ?? "", selection.anchorOffset);
  return token ? { ...token, node: node as Text } : null;
}

export function createSkillChip(skill: { name: string; description?: string }, icons: ChipIcons): HTMLElement {
  const chip = document.createElement("span");
  chip.className = "composer-skill";
  chip.contentEditable = "false";
  chip.setAttribute(skillAttr, skill.name);
  chip.title = skill.description || `/skill:${skill.name}`;
  chip.append(icons.skill.cloneNode(true));
  const label = document.createElement("span");
  label.className = "composer-skill-name";
  label.textContent = skillTitle(skill.name);
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "composer-skill-remove";
  remove.tabIndex = -1;
  remove.setAttribute("aria-label", tr("移除 Skill", "Remove skill"));
  remove.setAttribute("data-skill-remove", "");
  remove.append(icons.close.cloneNode(true));
  chip.append(label, remove);
  return chip;
}

function placeCaret(node: Node, offset: number): void {
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/** 用芯片替换 `/查询`，芯片后留一个空格并把光标放在空格之后。 */
export function insertSkillChip(token: EditorSlash, chip: HTMLElement): void {
  const { node } = token;
  const text = node.data;
  const tail = document.createTextNode(` ${text.slice(token.end).replace(/^[  ]+/, "")}`);
  const head = text.slice(0, token.start);
  if (head) node.data = head;
  node.after(chip, tail);
  if (!head) node.remove();
  placeCaret(tail, 1);
}

/** 去掉 `/查询`（选配方时用），光标留在原处。 */
export function removeSlashText(token: EditorSlash): void {
  const next = applySkillPick(token.node.data, token);
  token.node.data = next.text;
  placeCaret(token.node, next.caret);
}

/** 用纯文本整体替换输入框内容，光标放到末尾。 */
export function setEditorText(root: HTMLElement, text: string, caret: number = text.length): void {
  root.replaceChildren();
  if (!text) return;
  const node = document.createTextNode(text);
  root.append(node);
  placeCaret(node, Math.min(caret, text.length));
}

/** 去掉不在可用名单里的芯片（Skill 被停用或删除后）。返回是否删过。 */
export function pruneChips(root: HTMLElement, enabled: ReadonlySet<string>): boolean {
  let removed = false;
  for (const chip of Array.from(root.querySelectorAll(`[${skillAttr}]`))) {
    if (enabled.has(chip.getAttribute(skillAttr) ?? "")) continue;
    chip.remove();
    removed = true;
  }
  return removed;
}
