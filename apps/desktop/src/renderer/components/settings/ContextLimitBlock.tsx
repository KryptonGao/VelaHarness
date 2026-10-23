import { useEffect, useState } from "react";
import { type ContextLimitSettings } from "@vela/shared";
import type { SettingsCopy } from "../settings-copy";
import { ContextLimitControl } from "./ContextLimitControl";
import { SettingsBlock } from "./primitives";

/** 全局默认的对话上下文上限;单个对话可以在顶栏「上下文」标签页里单独覆盖。 */
export function ContextLimitBlock({ copy }: { copy: SettingsCopy }) {
  const text = copy.agent;
  const [saved, setSaved] = useState<ContextLimitSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const api = window.vela;
    if (!api) return;
    let active = true;
    void api.getContextLimit().then(
      (loaded) => { if (active) setSaved(loaded); },
      (caught: unknown) => { if (active) setLoadError(caught instanceof Error ? caught.message : String(caught)); },
    );
    return () => { active = false; };
  }, []);

  return (
    <SettingsBlock id="context-limit" title={text.contextLimit} hint={text.contextLimitHint}>
      <ContextLimitControl
        label={text.contextLimit}
        value={saved?.limitTokens ?? null}
        disabled={saved === null}
        onCommit={async (limitTokens) => {
          const api = window.vela;
          if (api) setSaved(await api.setContextLimit({ limitTokens }));
        }}
      />
      {loadError ? <p className="settings-error">{loadError}</p> : null}
    </SettingsBlock>
  );
}
