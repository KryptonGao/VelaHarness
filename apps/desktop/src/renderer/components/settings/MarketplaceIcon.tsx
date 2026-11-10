import type { MarketplaceCategory, MarketplaceSkillEntry } from "@vela/shared";
import type { CSSProperties } from "react";
import { marketplaceGlyphs } from "./marketplace-glyphs";

/**
 * 市场 Skill 的图标：浅色底的圆角方块，里面是一枚实色渐变徽章。
 * 底色用 color-mix 取自主色，深浅主题下都柔和；主色即徽章渐变的深端。
 * Office 四项各有自己的色和文档徽章，其余按分类着色，中间是各自的线条图形。
 */
interface Tone {
  from: string;
  to: string;
}

const officeTones: Record<string, Tone> = {
  docx: { from: "#5B9CFF", to: "#2F6BEA" },
  xlsx: { from: "#3DCB8B", to: "#16A06A" },
  pptx: { from: "#FFB938", to: "#FF8A1F" },
  pdf: { from: "#FF7A5C", to: "#F0453A" },
};

const categoryTones: Record<Exclude<MarketplaceCategory, "office">, Tone> = {
  agent: { from: "#A58BFF", to: "#7048E8" },
  docs: { from: "#34D8C0", to: "#0E9F8E" },
  frontend: { from: "#FF8CC0", to: "#E5489A" },
  engineering: { from: "#5CC8FF", to: "#1D8FE0" },
};

function OfficeGlyph({ id }: { id: string }) {
  const white = { stroke: "#fff", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };
  switch (id) {
    case "docx":
      return <g {...white}><path d="M8.5 9h7M8.5 12h7M8.5 15h4.5" /></g>;
    case "xlsx":
      return <g {...white}><rect x="7.5" y="8" width="9" height="8.5" rx="1" /><path d="M7.5 12.25h9M12 8v8.5" /></g>;
    case "pptx":
      return <g {...white}><rect x="7.5" y="8" width="9" height="6" rx="1" /><path d="M12 14v2.5M9.5 16.5h5" /></g>;
    default:
      return <text x="12" y="14.6" textAnchor="middle" fontSize="6.4" fontWeight="800" fill="#fff" fontFamily="system-ui, -apple-system, sans-serif">PDF</text>;
  }
}

export function MarketplaceIcon({ entry }: { entry: MarketplaceSkillEntry }) {
  const office = entry.category === "office";
  const tone = entry.category === "office" ? officeTones[entry.id] ?? officeTones.docx : categoryTones[entry.category];
  const gradient = `market-icon-${entry.id}`;
  const glyph = marketplaceGlyphs[entry.id];
  return (
    <span className="market-icon" style={{ "--market-tone": tone.to } as CSSProperties} aria-hidden="true">
      <svg viewBox="0 0 24 24" width="34" height="34">
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={tone.from} />
            <stop offset="1" stopColor={tone.to} />
          </linearGradient>
        </defs>
        {office ? (
          <>
            <rect x="4" y="3" width="16" height="18" rx="3.5" fill={`url(#${gradient})`} />
            <OfficeGlyph id={entry.id} />
          </>
        ) : (
          <>
            <rect x="3" y="3" width="18" height="18" rx="5" fill={`url(#${gradient})`} />
            {glyph ? <g color="#fff" transform="translate(5.4 5.4) scale(0.55)" dangerouslySetInnerHTML={{ __html: glyph }} /> : null}
          </>
        )}
      </svg>
    </span>
  );
}
