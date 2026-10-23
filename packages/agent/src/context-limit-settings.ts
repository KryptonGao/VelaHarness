import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { defaultContextLimitSettings, parseContextLimitSettings, readContextLimitSettings, type ContextLimitSettings } from "@vela/shared";

/** Profile 内持久化的上下文长度上限;文件损坏时回到不限制。 */
export class ContextLimitSettingsStore {
  private current: ContextLimitSettings = { ...defaultContextLimitSettings };
  private readonly path: string;

  constructor(private readonly agentDir: string) {
    this.path = join(agentDir, "context-limit-settings.json");
    try {
      this.current = readContextLimitSettings(JSON.parse(readFileSync(this.path, "utf8")));
    } catch {
      // 没有设置文件时沿用默认值。
    }
  }

  get settings(): ContextLimitSettings {
    return { ...this.current };
  }

  save(raw: unknown): ContextLimitSettings {
    const next = parseContextLimitSettings(raw);
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
