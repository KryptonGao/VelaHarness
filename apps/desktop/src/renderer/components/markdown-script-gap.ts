/**
 * 在中日韩文字与西文/数字相接处插入一个空的 .md-script-gap 行内元素,宽度由 CSS 决定。
 * 浏览器自带的 text-autospace 固定只有 1/8em 且不能调,这里改成自己控制间距;
 * 用元素而不是真的空格,复制出去的文字仍然和原文一致。内联代码、代码块不是 text 节点,不受影响。
 */
type MdNode = {
  type: string;
  value?: string;
  children?: MdNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
  data?: { hName?: string; hProperties?: Record<string, unknown>; srcOffset?: number };
};

const cjk = "\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}";
const boundary = new RegExp(`(?<=[${cjk}])(?=[A-Za-z0-9])|(?<=[A-Za-z0-9])(?=[${cjk}])`, "u");

function gapNode(): MdNode {
  return { type: "emphasis", children: [], data: { hName: "span", hProperties: { className: ["md-script-gap"], "aria-hidden": "true" } } };
}

// Keep decimal points, grouping separators and percent signs with the digits they qualify.
const numberRun = /(\p{Nd}+(?:[.,，．]\p{Nd}+)*[%％]?)/u;

function splitText(node: MdNode, strong: boolean): MdNode[] {
  const value = node.value ?? "";
  const parts = value.split(boundary);
  const markNumbers = strong && numberRun.test(value);
  if (parts.length < 2 && !markNumbers) return [node];
  // 保留每段在源码里的起点,淡入插件靠它判断哪些文字是新追加的。
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  const total = node.value?.length || 1;
  let consumed = 0;
  const out: MdNode[] = [];
  parts.forEach((part, index) => {
    if (index > 0) out.push(gapNode());
    const pieces = markNumbers ? part.split(numberRun) : [part];
    pieces.forEach((piece, i) => {
      if (!piece) return;
      const srcOffset = start === undefined ? undefined : start + Math.round(consumed * ((end ?? start + total) - start) / total);
      const text = { type: "text", value: piece, ...(srcOffset === undefined ? {} : { data: { srcOffset } }) };
      out.push(i % 2 === 0 ? text : {
        type: "emphasis", children: [text], data: { hName: "span", hProperties: { className: ["md-strong-number"] } },
      });
      consumed += piece.length;
    });
  });
  return out;
}

function walk(node: MdNode, strong = false): void {
  if (!node.children) return;
  const next: MdNode[] = [];
  for (const child of node.children) {
    if (child.type === "text") {
      next.push(...splitText(child, strong));
    } else {
      walk(child, strong || child.type === "strong");
      next.push(child);
    }
  }
  node.children = next;
}

export function remarkScriptGap() {
  return (tree: MdNode) => walk(tree);
}
