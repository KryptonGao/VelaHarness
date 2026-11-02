/** Vela 标:直臂加一面弧帆,单色,颜色跟随 currentColor。几何与 assets/icon 的应用图标一致。 */
export const velaMarkPaths = [
  "M252.0 282.0L402.0 282.0L524.5 498.8C496.7 535.6 468.9 575.2 441.8 617.8Z",
  "M772.0 282.0L512.0 742.0L460.0 650.0C540.0 512.0 668.0 372.0 772.0 282.0Z",
] as const;

export function VelaLogoMark({ height = 16 }: { height?: number }) {
  return (
    <svg viewBox="252 282 520 460" width={(height * 520) / 460} height={height} fill="currentColor"
      aria-hidden="true" focusable="false">
      {velaMarkPaths.map(d => <path key={d} d={d} />)}
    </svg>
  );
}

/** 字标 VELΛ:四个字母都是和 Logo 同一斜度的直线笔画,不依赖字体;最后的 Λ 没有横杠。 */
const wordmarkGlyphs = [
  { x: 0, d: "M0 0L24 0L68 77.9L112 0L136 0L68 120Z" },
  { x: 166, d: "M0 0L88 0L88 18L21 18L21 51L80 51L80 69L21 69L21 102L88 102L88 120L0 120Z" },
  { x: 284, d: "M0 0L21 0L21 102L82 102L82 120L0 120Z" },
  { x: 396, d: "M68 0L136 120L112 120L68 42.1L24 120L0 120Z" },
] as const;

export function VelaWordmark({ height = 10 }: { height?: number }) {
  return (
    <svg viewBox="0 0 532 120" width={(height * 532) / 120} height={height} fill="currentColor"
      aria-hidden="true" focusable="false">
      {wordmarkGlyphs.map(g => <path key={g.x} transform={`translate(${g.x} 0)`} d={g.d} />)}
    </svg>
  );
}

/** 左标右字的横版标识,用于侧边栏顶部。 */
export function VelaLogoLockup() {
  return (
    <span className="vela-lockup" role="img" aria-label="Vela">
      <VelaLogoMark height={20} />
      <VelaWordmark height={11} />
    </span>
  );
}
