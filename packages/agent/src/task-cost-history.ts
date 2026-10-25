import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { parseTaskCostHistory, taskCostHistoryLimits, type TaskCostRecord } from "@vela/shared";

/** 已结束任务的用量记录，给同类任务做费用预估。文件损坏时当作没有历史。 */
export class TaskCostHistoryStore {
  private records: TaskCostRecord[] = [];
  private readonly path: string;

  constructor(private readonly agentDir: string) {
    this.path = join(agentDir, "task-cost-history.json");
    try {
      this.records = parseTaskCostHistory(JSON.parse(readFileSync(this.path, "utf8")));
    } catch {
      // 没有历史文件时从空开始。
    }
  }

  list(): readonly TaskCostRecord[] {
    return this.records;
  }

  /** 追加一条记录；写盘失败只影响预估，不能打断任务收尾，所以交给调用方记录日志。 */
  append(record: TaskCostRecord): void {
    const next = [...this.records, record].slice(-taskCostHistoryLimits.maxRecords);
    mkdirSync(this.agentDir, { recursive: true });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, `${JSON.stringify(next)}\n`, { mode: 0o600, flag: "wx" });
      renameSync(temporary, this.path);
    } finally {
      rmSync(temporary, { force: true });
    }
    this.records = next;
  }
}
