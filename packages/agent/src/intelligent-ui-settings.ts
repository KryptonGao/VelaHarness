import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { defaultUiPreference, isUiPreference, type IntelligentUiState, type UiPreference } from "@vela/shared";

/** Profile 内持久化的 Intelligent UI 设置：偏好模式与「沙盒微应用」开关；不保存任何交互数据。 */
export class IntelligentUiSettings {
  preference: UiPreference = defaultUiPreference;
  /** 沙盒微应用默认关闭；只有用户明确打开，模型才会被告知可以使用 vela-app。 */
  microApps = false;
  private readonly path: string;

  constructor(private readonly agentDir: string) {
    this.path = join(agentDir, "intelligent-ui-settings.json");
    try {
      const value = JSON.parse(readFileSync(this.path, "utf8"));
      // 损坏或未知的值回到默认，而不是静默打开更激进的模式。
      if (isUiPreference(value?.preference)) this.preference = value.preference;
      if (value?.microApps === true) this.microApps = true;
    } catch {
      // 没有设置文件时沿用默认值。
    }
  }

  get state(): IntelligentUiState {
    return { preference: this.preference, microApps: this.microApps };
  }

  setPreference(preference: UiPreference): void {
    if (!isUiPreference(preference)) throw new Error("Intelligent UI 偏好无效");
    this.write({ preference, microApps: this.microApps });
    this.preference = preference;
  }

  setMicroApps(enabled: boolean): void {
    if (typeof enabled !== "boolean") throw new Error("微应用开关无效");
    this.write({ preference: this.preference, microApps: enabled });
    this.microApps = enabled;
  }

  private write(state: IntelligentUiState): void {
    mkdirSync(this.agentDir, { recursive: true });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600, flag: "wx" });
      renameSync(temporary, this.path);
    } finally {
      rmSync(temporary, { force: true });
    }
  }
}
