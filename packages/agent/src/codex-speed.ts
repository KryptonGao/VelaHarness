import type { Api, Model } from "@earendil-works/pi-ai";
import type { CodexSpeed, CodexSpeedTier } from "@vela/shared";

/** The Codex model catalog is scoped to the signed-in account. Older responses
 * advertise the same capability through additional_speed_tiers. */
export function parseCodexSpeedCatalog(body: unknown): Map<string, CodexSpeedTier[]> {
  if (!body || typeof body !== "object" || !("models" in body) || !Array.isArray(body.models)) {
    throw new Error("Invalid Codex model catalog");
  }
  const catalog = new Map<string, CodexSpeedTier[]>();
  for (const model of body.models) {
    if (!model || typeof model.slug !== "string") continue;
    const ids = Array.isArray(model.service_tiers)
      ? model.service_tiers.map((tier: { id?: unknown } | null) => tier?.id)
      : model.additional_speed_tiers;
    if (!Array.isArray(ids)) continue;
    const tiers: CodexSpeedTier[] = [];
    if (ids.includes("priority") || ids.includes("fast")) tiers.push("priority");
    if (ids.includes("ultrafast")) tiers.push("ultrafast");
    catalog.set(model.slug, tiers);
  }
  return catalog;
}

/** Pi's simple streaming API drops provider-specific options. Apply the tier
 * to the final Responses body, after Pi and installed extensions prepare it. */
export function codexSpeedPayload(body: unknown, model: Model<Api>, speed?: CodexSpeed): unknown {
  if (!speed || speed === "standard" || model.api !== "openai-codex-responses" ||
      (model.provider !== "openai-codex" && !model.provider.startsWith("openai-codex@"))) return body;
  return body && typeof body === "object" ? { ...body, service_tier: speed } : body;
}
