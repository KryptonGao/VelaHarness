import type { ProviderSummary } from "@vela/shared";
import { ArrowLeftIcon, ChevronRightIcon, PlusIcon } from "../icons";
import type { SettingsCopy } from "../settings-copy";
import { ProviderLogo } from "./models-parts";

/** 「添加供应商」页:尚未接入的内置提供方,加上创建自定义供应商的入口。 */
export function AddProviderPicker({
  copy,
  builtins,
  onPick,
  onCustom,
  onBack,
}: {
  copy: SettingsCopy;
  builtins: ProviderSummary[];
  onPick: (providerId: string) => void;
  onCustom: () => void;
  onBack: () => void;
}) {
  const text = copy.models;
  return (
    <div className="models-add">
      <div className="models-toolbar">
        <button type="button" className="models-back" onClick={onBack}>
          <ArrowLeftIcon size={15} />
          {text.add}
        </button>
      </div>

      <div className="models-add-body">
        <div className="models-add-group">{text.groupBuiltin}</div>
        {builtins.length === 0 ? <p className="settings-note">{text.pickBuiltinEmpty}</p> : (
          <div className="models-cards">
            {builtins.map((provider) => (
              <button type="button" className="models-card" key={provider.id} onClick={() => onPick(provider.id)}>
                <ProviderLogo provider={provider} size="lg" />
                <span className="models-card-copy">
                  <span className="models-card-title">{provider.name}</span>
                  <span className="models-card-sub">{provider.methods.map((method) => (method.type === "oauth" ? text.methodOauth : text.methodKey)).join(" / ")}</span>
                </span>
                <ChevronRightIcon size={14} />
              </button>
            ))}
          </div>
        )}

        <div className="models-add-group">{text.pickOther}</div>
        <div className="models-cards">
          <button type="button" className="models-card" onClick={onCustom}>
            <span className="models-logo lg plain"><PlusIcon size={16} /></span>
            <span className="models-card-copy">
              <span className="models-card-title">{text.createCustom}</span>
              <span className="models-card-sub">{text.createCustomHint}</span>
            </span>
            <ChevronRightIcon size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
