import type { CSSProperties, ReactNode } from "react";

/**
 * 引导用的「剪纸帆影」插画。颜色写死，不跟随应用主题——引导在明亮的色纸上进行，
 * 深色模式不会改变它。
 */
export const obColor = {
  cream: "#fbf4e4",
  desk: "#efe3ca",
  cobalt: "#1f4fd8",
  sky: "#9cc9ff",
  sun: "#ffc62e",
  coral: "#ff6b4a",
  green: "#1f9e8a",
  ink: "#131b45",
} as const;

/** 一条很长的波浪（周期 160px），横向漂移 160px 刚好首尾相接。 */
const wavePath = `M-200 0q40-36 80 0${"t80 0".repeat(24)}V220H-200Z`;

/** 整个引导共用的 SVG 元件，渲染一次，其他地方用 <use href="#ob-…"> 引用。 */
export function ObDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true" focusable="false">
      <defs>
        <path id="ob-frond" d="M50 96C46 80 40 72 24 70C8 68 4 54 16 48C2 40 6 22 22 26C20 10 38 2 46 16C52 2 72 6 70 22C86 18 96 34 84 46C98 52 94 70 78 70C62 72 54 80 50 96Z" />
        <path id="ob-star" d="M0-30C3-10 10-3 30 0C10 3 3 10 0 30C-3 10-10 3-30 0C-10-3-3-10 0-30Z" />
        <path id="ob-wave" d={wavePath} />
        <symbol id="ob-sail" viewBox="0 0 18 20">
          <path d="M8 0C13 6 16 12 17 18H8Z" fill={obColor.cobalt} />
          <path d="M6 4C5 10 3 14 0 18H6Z" fill={obColor.coral} />
        </symbol>
        <symbol id="ob-ship" viewBox="130 190 400 470">
          <rect x="315" y="196" width="8" height="376" rx="3" fill={obColor.ink} />
          <path d="M334 212C426 314 476 440 490 548H334Z" fill={obColor.cobalt} />
          <path d="M304 250C270 360 222 468 166 548H304Z" fill={obColor.cream} />
          <path d="M323 196L378 213L323 232Z" fill={obColor.coral} />
          <path d="M136 566H524C506 630 454 654 336 654C234 654 170 630 136 566Z" fill={obColor.coral} />
          <path d="M150 588H508" stroke={obColor.cream} strokeWidth="6" strokeLinecap="round" opacity=".9" />
        </symbol>
        <g id="ob-burst">
          <rect x="-44" y="-44" width="88" height="88" rx="6" />
          <rect x="-44" y="-44" width="88" height="88" rx="6" transform="rotate(22.5)" />
          <rect x="-44" y="-44" width="88" height="88" rx="6" transform="rotate(45)" />
          <rect x="-44" y="-44" width="88" height="88" rx="6" transform="rotate(67.5)" />
        </g>
      </defs>
    </svg>
  );
}

/** 一侧带波浪边的色块，高度随窗口拉伸。 */
export function ObPanel({ width, fill, edge }: { width: number; fill: string; edge: number }) {
  const d = `M0 0H${edge}C${edge + 68} 112 ${edge - 36} 250 ${edge + 28} 400C${edge + 90} 546 ${edge - 24} 682 ${edge + 44} 800H0Z`;
  return (
    <svg className="ob-panel" style={{ width }} viewBox={`0 0 ${width} 800`} preserveAspectRatio="none" aria-hidden="true">
      <path d={d} fill={fill} />
    </svg>
  );
}

/** 「第一眼」右侧的拼贴：落下的色纸、摇晃的帆船、漂移的海浪。 */
export function ObHelloArt() {
  const delay = (seconds: number): CSSProperties => ({ animationDelay: `${seconds}s` });
  return (
    <svg className="ob-collage" viewBox="0 0 640 800" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
      <circle className="ob-cut" style={delay(0.1)} cx="486" cy="172" r="92" fill={obColor.sun} />
      <use className="ob-cut" style={delay(0.25)} href="#ob-frond" transform="translate(108 70) rotate(-24) scale(1.35)" fill={obColor.green} />
      <use className="ob-cut" style={delay(0.4)} href="#ob-frond" transform="translate(520 366) rotate(38) scale(.95)" fill={obColor.coral} />
      <use className="ob-cut" style={delay(0.5)} href="#ob-star" transform="translate(168 300) scale(1.25)" fill={obColor.coral} />
      <use className="ob-cut" style={delay(0.6)} href="#ob-star" transform="translate(592 300) scale(.6)" fill={obColor.cobalt} />
      <g className="ob-drift slow"><use href="#ob-wave" y="590" fill={obColor.sky} /></g>
      <g className="ob-boat">
        <rect className="ob-cut" style={delay(0.7)} x="315" y="196" width="8" height="376" rx="3" fill={obColor.ink} />
        <path className="ob-cut" style={delay(0.85)} d="M334 212C426 314 476 440 490 548H334Z" fill={obColor.cobalt} />
        <path className="ob-cut" style={delay(1)} d="M304 250C270 360 222 468 166 548H304Z" fill={obColor.sky} />
        <path className="ob-cut" style={delay(1.1)} d="M323 196L378 213L323 232Z" fill={obColor.coral} />
        <path className="ob-cut" style={delay(1.2)} d="M136 566H524C506 630 454 654 336 654C234 654 170 630 136 566Z" fill={obColor.coral} />
        <path d="M150 588H508" stroke={obColor.cream} strokeWidth="6" strokeLinecap="round" opacity=".9" />
      </g>
      <g className="ob-drift"><use href="#ob-wave" y="648" fill={obColor.green} /></g>
      <g className="ob-drift slow"><use href="#ob-wave" y="716" fill={obColor.cobalt} /></g>
    </svg>
  );
}

/** 「启航」左下角的海面与帆船。 */
export function ObSea() {
  return (
    <svg className="ob-sea" viewBox="0 0 520 270" preserveAspectRatio="xMinYMax meet" aria-hidden="true">
      <clipPath id="ob-sea-clip"><path d="M0 0H492C506 90 470 180 506 270H0Z" /></clipPath>
      <g clipPath="url(#ob-sea-clip)">
        <g className="ob-drift slow"><use href="#ob-wave" y="150" fill={obColor.sky} /></g>
        <g className="ob-boat"><use href="#ob-ship" x="290" y="20" width="150" height="176" /></g>
        <g className="ob-drift"><use href="#ob-wave" y="184" fill={obColor.green} /></g>
        <g className="ob-drift slow"><use href="#ob-wave" y="222" fill={obColor.cobalt} /></g>
      </g>
    </svg>
  );
}

/** 版本号贴纸。 */
export function ObBurst({ text, fill, ink, className, style }: { text: string; fill: string; ink: string; className?: string; style?: CSSProperties }) {
  return (
    <svg className={`ob-burst ${className ?? ""}`} style={style} viewBox="-64 -64 128 128" aria-hidden="true">
      <use href="#ob-burst" fill={fill} />
      <text y="9" textAnchor="middle" fontWeight="700" fontSize={text.length > 6 ? 21 : 27} fill={ink}>{text}</text>
    </svg>
  );
}

/** 角落装饰（太阳、星、叶子）。 */
export function ObDeco({ className, size, children, viewBox }: { className?: string; size: number | [number, number]; viewBox: string; children: ReactNode }) {
  return <svg className={`ob-deco ${className ?? ""}`} width={Array.isArray(size) ? size[0] : size} height={Array.isArray(size) ? size[1] : size} viewBox={viewBox} aria-hidden="true">{children}</svg>;
}

/** 推理强度用帆的大小表示。 */
export function ObSail({ size }: { size: number }) {
  return <svg width={size} height={size * 1.1} aria-hidden="true"><use href="#ob-sail" /></svg>;
}
