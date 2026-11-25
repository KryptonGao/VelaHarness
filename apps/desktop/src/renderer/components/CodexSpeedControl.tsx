import type { CodexSpeed, CodexSpeedTier, ModelCatalog } from "@vela/shared";
import { useEffect, useId, useRef, useState } from "react";
import { localizeError, tr } from "../locale";
import { Icon } from "./icons";

export function useCodexSpeedTiers(account: string | null, model: string | null, open: boolean, catalog: ModelCatalog | null) {
  const [result, setResult] = useState<{ provider: string; model: string; tiers: CodexSpeedTier[] } | null>(null);
  useEffect(() => {
    let current = true;
    if (account && model && window.vela?.getCodexSpeedTiers) {
      void window.vela.getCodexSpeedTiers(account, model).then(tiers => {
        if (current) setResult({ provider: account, model, tiers });
      }, () => { if (current) setResult(null); });
    } else setResult(null);
    return () => { current = false; };
  }, [account, model, open, catalog]);
  return result && result.provider === account && result.model === model ? result.tiers : [];
}

export function speedLabel(speed: CodexSpeed) {
  if (speed === "priority") return tr("快速", "Fast");
  if (speed === "ultrafast") return tr("超快", "Ultrafast");
  return tr("标准", "Standard");
}

export function SpeedGlyph({ speed }: { speed: CodexSpeed }) {
  return (
    <span className={`codex-speed-glyph${speed === "ultrafast" ? " is-double" : ""}`} aria-hidden="true">
      {speed === "ultrafast" && <Icon name="lightning" size={14} className="speed-outline" />}
      <Icon name="lightning" size={14} filled={speed !== "standard"} />
    </span>
  );
}

export function CodexSpeedControl({ speed, tiers, disabled, onChange, subagent = false }: {
  subagent?: boolean;
  speed: CodexSpeed;
  tiers: CodexSpeedTier[];
  disabled: boolean;
  onChange: (speed: CodexSpeed) => Promise<unknown>;
}) {
  const id = useId();
  const menu = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const label = subagent ? tr("子代理加速", "Subagent speed") : tr("响应速度", "Response speed");
  const tierLabel = (tier: CodexSpeed) => subagent && tier === "standard" ? tr("不加速", "Off") : speedLabel(tier);
  const choices: CodexSpeed[] = ["standard", ...tiers];
  const menuRequired = subagent || tiers.includes("ultrafast");
  const change = async (next: CodexSpeed) => {
    menu.current?.hidePopover();
    setSaving(true);
    setError("");
    try {
      const result = await onChange(next);
      if (typeof result === "string") setError(localizeError(result));
    } catch (reason) {
      setError(localizeError(reason instanceof Error ? reason.message : String(reason)));
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <button type="button" className={`codex-speed-button${subagent ? " subagent-speed-button" : ""}${speed !== "standard" ? " is-active" : ""}`}
        title={`${label} · ${tierLabel(speed)}`} aria-label={`${label} · ${tierLabel(speed)}`}
        aria-pressed={menuRequired ? undefined : speed !== "standard"} disabled={disabled || saving}
        popoverTarget={menuRequired ? id : undefined}
        onClick={menuRequired ? undefined : () => void change(speed === "standard" ? "priority" : "standard")}>
        {subagent ? <Icon name="bot" size={16} /> : <SpeedGlyph speed={speed} />}
      </button>
      {menuRequired && (
        <div ref={menu} id={id} popover="auto" className="codex-speed-menu" role="group" aria-label={label}>
          {subagent && <header className="subagent-speed-note"><strong>{label}</strong>
            <small>{tr("仅用于本对话中支持所选档位的子代理。并行加速会消耗更多额度。", "Only supported subagents in this chat use the selected speed. Parallel use consumes more quota.")}</small>
          </header>}
          {choices.map(tier => (
            <button key={tier} type="button" disabled={disabled || saving} aria-pressed={speed === tier} onClick={() => void change(tier)}>
              <span>{tierLabel(tier)}</span>
              {speed === tier && <Icon name="check" size={14} />}
              <small>{tier === "standard" ? tr("默认速度", "Default speed") : tier === "priority"
                ? tr("更快响应，用量更高", "Faster responses, higher usage")
                : tr("最快响应，用量最高", "Fastest responses, highest usage")}</small>
            </button>
          ))}
        </div>
      )}
      {error && <small role="alert" className="codex-speed-error">{error}</small>}
    </>
  );
}
