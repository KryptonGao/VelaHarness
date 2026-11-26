import type { Api, Model } from "@earendil-works/pi-ai";

export function openCodeSessionHeaders(model: Model<Api>, sessionId: string): Record<string, string> | undefined {
  let openCode = model.provider === "opencode" || model.provider === "opencode-go";
  if (!openCode) {
    try {
      openCode = new URL(model.baseUrl).hostname === "opencode.ai";
    } catch {
      // An invalid base URL cannot identify a custom OpenCode endpoint.
    }
  }
  return openCode ? { "x-opencode-session": sessionId } : undefined;
}

/** Only OpenCode needs the parent ID. A provider sessionId would share the chat's cached continuation. */
export function auxiliaryRequestOptions(model: Model<Api>, routingId: string) {
  return { cacheRetention: "none" as const, headers: openCodeSessionHeaders(model, routingId) };
}
