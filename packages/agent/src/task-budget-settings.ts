import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { defaultTaskBudgetSettings, parseTaskBudgetSettings, readTaskBudgetSettings, type TaskBudgetSettings } from "@vela/shared";

/** Profile 内持久化的任务用量上限；文件损坏时回到默认（关闭）。 */
export class TaskBudgetSettingsStore {
  private current: TaskBudgetSettings = { ...defaultTaskBudgetSettings };
  private readonly path: string;

  constructor(private readonly agentDir: string) {
    this.path = join(agentDir, "task-budget-settings.json");
    try {
      this.current = readTaskBudgetSettings(JSON.parse(readFileSync(this.path, "utf8")));
    } catch {
      // 没有设置文件时沿用默认值。
    }
  }

  get settings(): TaskBudgetSettings {
    return { ...this.current };
  }

  save(raw: unknown): TaskBudgetSettings {
    const next = parseTaskBudgetSettings(raw);
    mkdirSync(this.agentDir, { recursive: true });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, `${JSON.stringify(next)}\n`, { mode: 0o600, flag: "wx" });
      renameSync(temporary, this.path);
    } finally {
      rmSync(temporary, { force: true });
    }
    this.current = next;
    return this.settings;
  }
}
