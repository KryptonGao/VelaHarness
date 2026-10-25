import { createReadStream } from "node:fs";
import type { TraceRequest, TraceSummaryRequest } from "@vela/shared";

export interface TraceUsageRecords {
  requests: TraceRequest[];
  summaries: TraceSummaryRequest[];
  /** 有无法解析的记录时为 true，调用方据此提示统计可能不完整。 */
  damaged: boolean;
}

const wanted = [Buffer.from('{"type":"request"'), Buffer.from('{"type":"summary"')];
const prefixLength = Math.max(...wanted.map(prefix => prefix.length));
const matches = (head: Buffer) => wanted.some(prefix => head.subarray(0, prefix.length).equals(prefix));

/** 逐行扫描，只把 request / summary 行解码成字符串；node、context 行（占文件绝大部分）按字节前缀直接跳过。 */
async function scanLines(file: string, onLine: (line: string) => void): Promise<void> {
  let parts: Buffer[] = [];
  let length = 0;
  // null = 这一行还不够长，无法判断；false = 不需要的行，后续片段直接丢弃。
  let keep: boolean | null = null;
  const take = (piece: Buffer) => {
    if (keep === false || piece.length === 0) return;
    parts.push(piece);
    length += piece.length;
    if (keep !== null || length < prefixLength) return;
    keep = matches(Buffer.concat(parts, length).subarray(0, prefixLength));
    if (!keep) { parts = []; length = 0; }
  };
  const finish = () => {
    if (length > 0) {
      const line = Buffer.concat(parts, length);
      if (keep ?? matches(line)) onLine(line.toString("utf8"));
    }
    parts = [];
    length = 0;
    keep = null;
  };
  for await (const chunk of createReadStream(file, { highWaterMark: 1 << 20 }) as AsyncIterable<Buffer>) {
    let start = 0;
    for (let end = chunk.indexOf(10, start); end !== -1; end = chunk.indexOf(10, start)) {
      take(chunk.subarray(start, end));
      finish();
      start = end + 1;
    }
    take(chunk.subarray(start));
  }
  finish();
}

/** request 记录里 `blocks`（模型原始回复）紧跟在 `request` 之后，用量统计用不上，解析前先截掉。 */
function parseRecord(line: string): unknown {
  const cut = line.indexOf(',"blocks":');
  if (cut > 0) {
    try { return JSON.parse(`${line.slice(0, cut)}}}`); } catch { /* 退回完整解析 */ }
  }
  return JSON.parse(line);
}

/** 从落盘的轨迹文件里只读出模型请求和总结请求；同一个 id 以后写入的为准，与 TraceRecorder 的读取一致。 */
export async function readTraceUsage(file: string): Promise<TraceUsageRecords> {
  const requests = new Map<string, TraceRequest>();
  const summaries = new Map<string, TraceSummaryRequest>();
  let damaged = false;
  await scanLines(file, line => {
    try {
      const record = parseRecord(line) as { type: string; value: { request?: TraceRequest } & TraceSummaryRequest };
      if (record.type === "request" && record.value.request) requests.set(record.value.request.id, record.value.request);
      else if (record.type === "summary") summaries.set(record.value.id, record.value);
    } catch {
      damaged = true;
    }
  });
  return {
    requests: [...requests.values()].sort((a, b) => a.number - b.number),
    summaries: [...summaries.values()],
    damaged,
  };
}
