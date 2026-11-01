import { customModelApis, type CustomModelApi } from "@vela/shared";
import { useState } from "react";
import { CubeIcon, EyeIcon, EyeOffIcon } from "../icons";
import type { SettingsCopy } from "../settings-copy";
import { providerMonogram } from "./models-view";
import { isColorIcon, monoIconTint, providerIconName } from "./provider-icons";

/** 随包的供应商图标,按文件名索引。彩色版直接用 <img>,单色版用 mask 绘制,颜色跟随主题。 */
const iconUrls = import.meta.glob<string>("../../assets/providers/*.svg", { query: "?url", import: "default", eager: true });

/** 小图标会被 Vite 内联成 data URI,里面可能带括号和引号,必须整体加引号才是合法的 url()。 */
function cssUrl(url: string): string {
  return `url(${JSON.stringify(url)})`;
}

function findIcon(provider: { id?: string; name: string }): { name: string; url: string } | null {
  const name = providerIconName(provider);
  const url = name ? iconUrls[`../../assets/providers/${name}.svg`] : undefined;
  return name && url ? { name, url } : null;
}

export function ProviderLogo({ provider, size = "sm" }: { provider: { id?: string; name: string; custom: boolean }; size?: "sm" | "lg" }) {
  const icon = findIcon(provider);
  if (icon) {
    return (
      <span className={`models-logo tile ${size}${isColorIcon(icon.name) ? " color" : ""}`} aria-hidden="true">
        {isColorIcon(icon.name) ? (
          <img className="models-logo-img" src={icon.url} alt="" draggable={false} />
        ) : (
          <span
            className="models-logo-glyph"
            style={{ maskImage: cssUrl(icon.url), WebkitMaskImage: cssUrl(icon.url), ...(monoIconTint[icon.name] ? { color: monoIconTint[icon.name] } : {}) }}
          />
        )}
      </span>
    );
  }
  if (provider.custom) {
    return <span className={`models-logo ${size}`}><CubeIcon size={size === "lg" ? 24 : 18} /></span>;
  }
  const { letter, hue } = providerMonogram(provider.name);
  return (
    <span className={`models-logo mono ${size}`} style={{ background: `hsl(${hue} 42% 46%)` }} aria-hidden="true">
      {letter}
    </span>
  );
}

export interface ModelDraft {
  modelId: string;
  modelName: string;
  reasoning: boolean;
  contextWindow: string;
  maxTokens: string;
}

export const emptyModelDraft: ModelDraft = { modelId: "", modelName: "", reasoning: false, contextWindow: "", maxTokens: "" };

export function countOrNull(value: string): number | null {
  const digits = value.replace(/\D/g, "");
  return digits ? Number(digits) : null;
}

/** 模型 ID、显示名称、上下文长度、最大输出和推理开关;新增和编辑共用。 */
export function ModelFields({
  copy,
  value,
  idLocked = false,
  onChange,
}: {
  copy: SettingsCopy["models"];
  value: ModelDraft;
  idLocked?: boolean;
  onChange: (next: ModelDraft) => void;
}) {
  return (
    <div className="models-fields">
      <label className="models-field">
        <span>{copy.modelId}</span>
        <input
          className="mono"
          value={value.modelId}
          placeholder={copy.modelIdPlaceholder}
          spellCheck={false}
          disabled={idLocked}
          onChange={(event) => onChange({ ...value, modelId: event.target.value })}
        />
      </label>
      <label className="models-field">
        <span>{copy.displayName}</span>
        <input value={value.modelName} placeholder={copy.displayNamePlaceholder} onChange={(event) => onChange({ ...value, modelName: event.target.value })} />
      </label>
      <label className="models-field">
        <span>{copy.context}</span>
        <input
          className="mono"
          inputMode="numeric"
          value={value.contextWindow}
          placeholder={copy.optionalPlaceholder}
          onChange={(event) => onChange({ ...value, contextWindow: event.target.value.replace(/\D/g, "") })}
        />
      </label>
      <label className="models-field">
        <span>{copy.maxOutput}</span>
        <input
          className="mono"
          inputMode="numeric"
          value={value.maxTokens}
          placeholder={copy.optionalPlaceholder}
          onChange={(event) => onChange({ ...value, maxTokens: event.target.value.replace(/\D/g, "") })}
        />
      </label>
      <label className="check-row models-fields-wide">
        <input type="checkbox" checked={value.reasoning} onChange={(event) => onChange({ ...value, reasoning: event.target.checked })} />
        <span>{copy.reasoning}</span>
      </label>
    </div>
  );
}

export function ApiSelect({ copy, value, onChange }: { copy: SettingsCopy["models"]; value: CustomModelApi; onChange: (next: CustomModelApi) => void }) {
  return (
    <label className="models-field">
      <span>{copy.api}</span>
      <select value={value} onChange={(event) => onChange(event.target.value as CustomModelApi)}>
        {customModelApis.map((api) => (
          <option key={api} value={api}>{copy.apis[api]}</option>
        ))}
      </select>
    </label>
  );
}

export function KeyField({
  copy,
  value,
  placeholder,
  onChange,
}: {
  copy: SettingsCopy["models"];
  value: string;
  placeholder: string;
  onChange: (next: string) => void;
}) {
  const [shown, setShown] = useState(false);
  return (
    <label className="models-field">
      <span>{copy.apiKeyField}</span>
      <span className="models-key">
        <input
          className="mono"
          type={shown ? "text" : "password"}
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          className="models-icon-btn"
          aria-label={shown ? copy.hideKey : copy.showKey}
          title={shown ? copy.hideKey : copy.showKey}
          onClick={() => setShown((current) => !current)}
        >
          {shown ? <EyeOffIcon size={15} /> : <EyeIcon size={15} />}
        </button>
      </span>
    </label>
  );
}
