import type { AgentInfo } from "@vela/shared";
import { useEffect, useState } from "react";
import { useReducedMotion } from "../hooks/useMotionPresence";
import { tr, trf, useAppLocale } from "../locale";
import { formatTokenCount } from "./AgentPanel";
import { formatSpeed } from "./composer/composer-stats";

export function AgentHeaderMetric({ agent }: { agent: AgentInfo }) {
  useAppLocale();
  const metrics = [
    { label: tr("用量", "Usage"), value: `${agent.usage.total > 0 ? formatTokenCount(agent.usage.total) : "—"} tok` },
    { label: tr("输出速度", "Output speed"), value: `${agent.outputSpeed ? formatSpeed(agent.outputSpeed) : "—"} tok/s` },
  ];
  const [index, setIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const reduced = useReducedMotion();
  const count = metrics.length;
  useEffect(() => {
    if (reduced || hovered || focused) return;
    const timer = window.setInterval(() => setIndex(i => (i + 1) % count), 4000);
    return () => window.clearInterval(timer);
  }, [count, reduced, hovered, focused]);
  const active = index % count;
  const current = metrics[active]!;
  const next = trf("下一项：{0}", "Next: {0}", metrics[(active + 1) % count]!.label);
  const description = `${current.label}: ${current.value} · ${next}`;
  return <button type="button" className="agent-header-metric" title={description} aria-label={description}
    onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onClick={() => setIndex((active + 1) % count)}>
    {metrics.map(({ label, value }, i) => <span key={label} className="overflow-fade-text" aria-hidden={i !== active}>{value}</span>)}
  </button>;
}
