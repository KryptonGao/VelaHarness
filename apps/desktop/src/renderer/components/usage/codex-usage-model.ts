import type { CodexUsageBucket } from "@vela/shared";

/** Stats group by provider/model; saved price keys still identify the individual speed tier. */
export function codexUsageRecord(bucket: CodexUsageBucket) {
  const { provider, model, tier, complete, timestamp, usage, requests } = bucket;
  const key = `${provider ?? "?"}/${model ?? ""}`;
  const rate = tier === "default" ? key : `${key} [${tier ?? "?"}]`;
  return {
    id: JSON.stringify(["codex-app", key, tier, complete, timestamp]), model: key,
    displayModel: model ?? "", tier,
    priceKey: provider && model && complete ? rate : null, requestCount: requests, missingBreakdown: !complete,
    startedAt: timestamp, completedAt: timestamp, usage,
  };
}
