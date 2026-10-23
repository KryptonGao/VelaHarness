import { contextLimitBounds } from "@vela/shared";
import { useEffect, useState } from "react";
import { localizeError, tr, trf } from "../../locale";
import { Segmented } from "./primitives";

/** 一 K 按 1000 token 计,与模型窗口的常见写法(200K、1M)一致。 */
const tokensPerK = 1000;
const presetsK = [32, 64, 128, 200, 1000] as const;

function presetLabel(k: number): string {
  return k >= 1000 ? `${k / 1000}M` : `${k}K`;
}

/** 预设档位加精确的 K 输入框;留空或选「不限」表示不限制。设置页和对话的「上下文」标签页共用。 */
export function ContextLimitControl({ label, value, disabled, onCommit }: {
  label: string;
  value: number | null;
  disabled?: boolean;
  onCommit: (limitTokens: number | null) => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setDraft(value === null ? "" : String(value / tokensPerK)); }, [value]);

  async function commit(limitTokens: number | null) {
    try {
      await onCommit(limitTokens);
      setError(null);
    } catch (caught) {
      setError(localizeError(caught instanceof Error ? caught.message : String(caught)));
    }
  }

  function commitDraft() {
    const trimmed = draft.trim();
    if (!trimmed) { if (value !== null) void commit(null); return; }
    const k = Number(trimmed);
    if (!Number.isFinite(k)) { setError(tr("请输入数字", "Enter a number")); return; }
    const tokens = Math.round(k * tokensPerK);
    if (tokens !== value) void commit(tokens);
  }

  const currentK = value === null ? null : value / tokensPerK;
  const selected = currentK === null ? "none" : (presetsK as readonly number[]).includes(currentK) ? String(currentK) : "custom";
  const options = [
    { id: "none", label: tr("不限", "No limit") },
    ...presetsK.map((k) => ({ id: String(k), label: presetLabel(k) })),
    ...(selected === "custom" ? [{ id: "custom", label: trf("{0}K", "{0}K", currentK!) }] : []),
  ];

  return (
    <div className="ctx-limit-control" data-disabled={disabled ? "true" : undefined}>
      <Segmented
        label={label}
        value={selected}
        options={options}
        onChange={(id) => { if (disabled || id === "custom") return; void commit(id === "none" ? null : Number(id) * tokensPerK); }}
      />
      <label className="tb-number">
        <input
          type="number"
          aria-label={label}
          inputMode="numeric"
          min={contextLimitBounds.minTokens / tokensPerK}
          max={contextLimitBounds.maxTokens / tokensPerK}
          step={1}
          value={draft}
          placeholder={tr("不限", "No limit")}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitDraft}
          onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
        />
        <span aria-hidden="true">K</span>
      </label>
      {error ? <p className="settings-error">{error}</p> : null}
    </div>
  );
}
