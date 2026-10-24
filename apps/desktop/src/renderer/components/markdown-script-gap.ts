/**
 * 在中日韩文字与西文/数字相接处插入一个空的 .md-script-gap 行内元素,宽度由 CSS 决定。
 * 浏览器自带的 text-autospace 固定只有 1/8em 且不能调,这里改成自己控制间距;
 * 用元素而不是真的空格,复制出去的文字仍然和原文一致。内联代码、代码块不是 text 节点,不受影响。
 */
type MdNode = {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: { hName?: string; hProperties?: Record<string, unknown> };
};

const cjk = "\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}";
const boundary = new RegExp(`(?<=[${cjk}])(?=[A-Za-z0-9])|(?<=[A-Za-z0-9])(?=[${cjk}])`, "u");

function gapNode(): MdNode {
  return { type: "emphasis", children: [], data: { hName: "span", hProperties: { className: ["md-script-gap"], "aria-hidden": "true" } } };
}

function splitText(node: MdNode): MdNode[] {
  const parts = (node.value ?? "").split(boundary);
  if (parts.length < 2) return [node];
  const out: MdNode[] = [];
  parts.forEach((part, index) => {
    if (index > 0) out.push(gapNode());
    out.push({ type: "text", value: part });
  });
  return out;
}

function walk(node: MdNode): void {
  if (!node.children) return;
  const next: MdNode[] = [];
  for (const child of node.children) {
    if (child.type === "text") {
      next.push(...splitText(child));
    } else {
      walk(child);
      next.push(child);
    }
  }
  node.children = next;
}

export function remarkScriptGap() {
  return (tree: MdNode) => walk(tree);
}
