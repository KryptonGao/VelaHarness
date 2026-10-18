import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { defaultCheckpointSettings, parseCheckpointSettings, readCheckpointSettings, type CheckpointSettings } from "@vela/shared";

/** Profile 内持久化的文件检查点开关；文件损坏或缺失时保持开启。 */
export class CheckpointSettingsStore {
  private current: CheckpointSettings = { ...defaultCheckpointSettings };
  private readonly path: string;

  constructor(private readonly agentDir: string) {
    this.path = join(agentDir, "checkpoint-settings.json");
    try {
      this.current = readCheckpointSettings(JSON.parse(readFileSync(this.path, "utf8")));
    } catch {
      // 没有设置文件时沿用默认值。
    }
  }

  get settings(): CheckpointSettings {
    return { ...this.current };
  }

  save(raw: unknown): CheckpointSettings {
    const next = parseCheckpointSettings(raw);
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
