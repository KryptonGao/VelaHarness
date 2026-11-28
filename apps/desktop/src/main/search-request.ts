import type { ConversationSearchRequest } from "@vela/shared";

const maxQueryLength = 1000;
const maxRequestIdLength = 64;

export function parseRequestId(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > maxRequestIdLength) throw new Error("Invalid search request id");
  return value;
}

/** Renderer input is untrusted: keep only the known fields, in range. */
export function parseSearchRequest(value: unknown): ConversationSearchRequest {
  const input = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const filters = (input.filters && typeof input.filters === "object" ? input.filters : {}) as Record<string, unknown>;
  if (typeof input.query !== "string") throw new Error("Invalid search query");
  const number = (field: unknown) => typeof field === "number" && Number.isFinite(field) ? field : undefined;
  const after = number(input.after);
  const from = number(filters.from);
  const to = number(filters.to);
  return {
    query: input.query.slice(0, maxQueryLength),
    filters: {
      ...(typeof filters.workspace === "string" ? { workspace: filters.workspace } : {}),
      ...(from !== undefined ? { from } : {}),
      ...(to !== undefined ? { to } : {}),
      includeArchived: filters.includeArchived !== false,
      includeTools: filters.includeTools !== false,
    },
    ...(after !== undefined ? { after } : {}),
  };
}
