import type { TraceUsage } from "./trace";

export const codexUsageEnabledKey = "vela.codexAppUsageEnabled";

/** One local calendar day's metered requests at the same model and service tier. */
export interface CodexUsageBucket {
  provider: string | null;
  model: string | null;
  tier: string | null;
  complete: boolean;
  timestamp: number | null;
  requests: number;
  usage: TraceUsage;
}

export interface CodexUsageReport {
  buckets: CodexUsageBucket[];
  incompleteFiles: number;
}

