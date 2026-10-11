/**
 * 把屏幕上的 SVG 图表保存成静态 PNG（IUI-12）。
 * 导出的是图形本身：只复制绘制需要的计算样式（颜色、线宽、字体），不带脚本、事件或外部引用。
 */

const copiedProperties = [
  "fill", "fill-opacity", "stroke", "stroke-width", "stroke-dasharray", "stroke-linecap", "stroke-linejoin", "opacity",
  "font-family", "font-size", "font-weight", "text-anchor", "dominant-baseline", "display", "visibility",
] as const;

function inlineComputedStyles(source: Element, target: Element): void {
  const computed = getComputedStyle(source);
  const style = copiedProperties.map(property => `${property}:${computed.getPropertyValue(property)}`).join(";");
  target.setAttribute("style", style);
  // 与交互有关的属性不进入图片。
  for (const name of target.getAttributeNames()) if (name.startsWith("on") || name === "tabindex") target.removeAttribute(name);
}

function backgroundOf(element: Element): string {
  for (let node: Element | null = element; node; node = node.parentElement) {
    const color = getComputedStyle(node).backgroundColor;
    if (color && color !== "rgba(0, 0, 0, 0)" && color !== "transparent") return color;
  }
  return "#ffffff";
}

function safeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  return cleaned || "chart";
}

export async function svgToPngBlob(svg: SVGSVGElement, scale = 2): Promise<Blob | null> {
  const box = svg.viewBox.baseVal;
  const width = box && box.width > 0 ? box.width : svg.clientWidth;
  const height = box && box.height > 0 ? box.height : svg.clientHeight;
  if (!width || !height) return null;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const sources = [svg, ...Array.from(svg.querySelectorAll("*"))];
  const targets = [clone, ...Array.from(clone.querySelectorAll("*"))];
  sources.forEach((element, index) => { if (targets[index]) inlineComputedStyles(element, targets[index]); });
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  const xml = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = new Image();
    image.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("image load failed"));
      image.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.fillStyle = backgroundOf(svg);
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 触发保存：成功返回 true。 */
export async function exportSvgAsPng(svg: SVGSVGElement, name: string): Promise<boolean> {
  const blob = await svgToPngBlob(svg);
  if (!blob) return false;
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = `${safeFileName(name)}.png`;
    link.rel = "noopener";
    document.body.append(link);
    link.click();
    link.remove();
    return true;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}
