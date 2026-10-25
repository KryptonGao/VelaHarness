import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { parseModelPrice, parseModelPrices, serializeModelPrices, type ModelPrice } from "@vela/shared";

/**
 * 模型价格的主进程副本。价格由渲染层的设置页维护并同步过来，
 * 费用上限和任务费用预估都在主进程里计算，所以需要自己持有一份。
 * `prices` 为 null 表示渲染层还没同步过，此时渲染层会把已有的价格推上来。
 */
export class ModelPriceStore {
  private current: ModelPrice[] | null = null;
  private readonly path: string;

  constructor(private readonly agentDir: string) {
    this.path = join(agentDir, "model-prices.json");
    try {
      this.current = parseModelPrices(readFileSync(this.path, "utf8"));
    } catch {
      // 没有文件：价格还没同步过。
    }
  }

  get prices(): readonly ModelPrice[] {
    return this.current ?? [];
  }

  get synced(): boolean {
    return this.current !== null;
  }

  list(): ModelPrice[] | null {
    return this.current ? [...this.current] : null;
  }

  /** 整体替换；非法条目直接拒绝，不静默丢弃，免得设置页以为保存成功而费用上限没有按预期生效。 */
  save(raw: unknown): void {
    if (!Array.isArray(raw)) throw new Error("模型价格格式不正确");
    const prices = new Map<string, ModelPrice>();
    for (const item of raw) {
      const price = parseModelPrice(item);
      if (!price) throw new Error("模型价格格式不正确");
      prices.set(price.model, price);
    }
    const next = [...prices.values()];
    mkdirSync(this.agentDir, { recursive: true });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, `${serializeModelPrices(next)}\n`, { mode: 0o600, flag: "wx" });
      renameSync(temporary, this.path);
    } finally {
      rmSync(temporary, { force: true });
    }
    this.current = next;
  }
}
