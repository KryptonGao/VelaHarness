/**
 * 用画布量宽度判断系统是否装了某个字体:字体不存在时浏览器会落到后面的备用字体,
 * 两种备用字体下宽度都与目标字体不同,才算已安装。document.fonts.check 对未安装的本地字体也返回 true,不能用。
 */
export function isFontInstalled(family: string): boolean {
  try {
    const context = document.createElement("canvas").getContext("2d");
    if (!context) return false;
    const sample = "mmmmmmmmmmlli0OWagé";
    const widthOf = (font: string) => {
      context.font = `72px ${font}`;
      return context.measureText(sample).width;
    };
    return ["monospace", "serif", "sans-serif"].some((base) => widthOf(`"${family}", ${base}`) !== widthOf(base));
  } catch {
    return false;
  }
}

/** 明体西文实际用到的字体:装了 Anthropic Serif 就是它,否则落到 Georgia。 */
export function serifLatinInUse(): "anthropic-serif" | "georgia" {
  return isFontInstalled("Anthropic Serif Text") || isFontInstalled("Anthropic Serif") ? "anthropic-serif" : "georgia";
}
