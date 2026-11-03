import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { redactSensitive } from "@vela/shared";
import { HeadlessRequestError, type HeadlessRunResult } from "./types";

export const runRecordVersion = 1;

export interface RunDirectory {
  runDir: string;
  agentDir: string;
  cacheDir: string;
}

/** UUID 独占创建：已存在的运行目录一律拒绝复用。 */
export async function createRunDirectory(dataDir: string, runId: string, configDir: string): Promise<RunDirectory> {
  const runDir = resolve(dataDir, "runs", runId);
  if (runDir === resolve(configDir)) throw new HeadlessRequestError("config_error", "运行目录不能与模型配置目录相同");
  try {
    await mkdir(join(dataDir, "runs"), { recursive: true, mode: 0o700 });
    await mkdir(runDir, { mode: 0o700 });
    const agentDir = join(runDir, "agent");
    const cacheDir = join(runDir, "cache");
    await mkdir(agentDir, { mode: 0o700 });
    await mkdir(cacheDir, { mode: 0o700 });
    return { runDir, agentDir, cacheDir };
  } catch (error) {
    throw new HeadlessRequestError("config_error", `无法创建运行目录：${error instanceof Error ? error.message : String(error)}`);
  }
}

export interface RunRecord {
  version: typeof runRecordVersion;
  runId: string;
  status: "starting" | "running" | HeadlessRunResult["status"];
  createdAt: string;
  updatedAt: string;
  endedAt: string | null;
  /** 请求元数据；提示词只记录长度和摘要，不重复保存正文。 */
  request: Record<string, unknown>;
  conversationId: string | null;
  result: HeadlessRunResult | null;
  error: HeadlessRunResult["error"];
}

/** run.json 的原子替换写入。不记录凭据。 */
export class RunRecordStore {
  private record: RunRecord;
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private readonly runDir: string,
    initial: Omit<RunRecord, "version" | "updatedAt" | "endedAt" | "result" | "error" | "conversationId">,
    private readonly secrets: readonly string[] = [],
  ) {
    this.record = { version: runRecordVersion, updatedAt: initial.createdAt, endedAt: null, result: null, error: null, conversationId: null, ...initial };
  }

  /** 失败会抛出：调用方据此决定能否报告成功。 */
  update(patch: Partial<Pick<RunRecord, "status" | "conversationId" | "result" | "error" | "endedAt">>): Promise<void> {
    this.record = { ...this.record, ...patch, updatedAt: new Date().toISOString() };
    const body = `${JSON.stringify(redactSensitive(this.record, this.secrets), null, 2)}\n`;
    const write = this.writing.then(async () => {
      const file = join(this.runDir, "run.json");
      const temp = `${file}.${process.pid}.tmp`;
      await writeFile(temp, body, { encoding: "utf8", mode: 0o600 });
      await chmod(temp, 0o600);
      await rename(temp, file);
    });
    this.writing = write.catch(() => undefined);
    return write;
  }
}
