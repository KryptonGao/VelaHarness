import type { TaskBudgetSettings } from "@vela/shared";
import { useEffect, useState } from "react";
import type { SettingsCopy } from "../settings-copy";
import { SettingsBlock } from "./primitives";
import { TaskBudgetFields } from "./TaskBudgetFields";

/** 全局默认的任务用量上限；单个对话可以在「用量限制」标签页里单独覆盖。 */
export function TaskBudgetBlock({ copy }: { copy: SettingsCopy }) {
  const text = copy.agent;
  const [saved, setSaved] = useState<TaskBudgetSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const api = window.vela;
    if (!api) return;
    let active = true;
    void api.getTaskBudget().then(
      (loaded) => { if (active) setSaved(loaded); },
      (caught: unknown) => { if (active) setLoadError(caught instanceof Error ? caught.message : String(caught)); },
    );
    return () => { active = false; };
  }, []);

  return (
    <SettingsBlock id="task-budget" title={text.taskBudget} hint={text.taskBudgetHint}>
      <TaskBudgetFields
        text={text}
        value={saved}
        onCommit={async (next) => {
          const api = window.vela;
          if (api) setSaved(await api.setTaskBudget(next));
        }}
      />
      {loadError ? <p className="settings-error">{loadError}</p> : null}
    </SettingsBlock>
  );
}
