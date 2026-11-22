import { customReasoningLevels, type CustomReasoningEffort } from "@vela/shared";
import type { SettingsCopy } from "../settings-copy";

export function CustomReasoningFields({ copy, efforts, onChange }: {
  copy: SettingsCopy["models"];
  efforts: CustomReasoningEffort[];
  onChange: (efforts: CustomReasoningEffort[]) => void;
}) {
  return (
    <fieldset className="models-reasoning-fields">
      <legend>{copy.reasoningLevels}</legend>
      <div className="settings-segment models-reasoning-options">
        {customReasoningLevels.map(level => {
          const selected = efforts.includes(level);
          return (
            <button key={level} type="button" className={`settings-segment-item${selected ? " active" : ""}`}
              aria-pressed={selected}
              onClick={() => onChange(selected ? efforts.filter(item => item !== level) : [...efforts, level])}>
              {level}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
