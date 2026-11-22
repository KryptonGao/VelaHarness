export const maxProviderNoteLength = 120;

export interface ProviderProfile {
  account?: { builtinId: string; number: number };
  note?: string;
}

/** Read only non-secret profile metadata when opening or importing a configuration. */
export function parseProviderProfile(id: string, raw: unknown): ProviderProfile | undefined {
  if (!raw || typeof raw !== "object" || id === "__proto__") return;
  const note = "note" in raw && typeof raw.note === "string" ? raw.note.trim().slice(0, maxProviderNoteLength) : "";
  if (!("account" in raw)) return note ? { note } : undefined;
  const account = raw.account;
  if (!account || typeof account !== "object" || !("builtinId" in account) || typeof account.builtinId !== "string" ||
      !("number" in account) || typeof account.number !== "number" || !Number.isSafeInteger(account.number) || account.number < 2 ||
      id.split("@")[0] !== account.builtinId || !id.includes("@")) return;
  return { account: { builtinId: account.builtinId, number: account.number }, ...(note && { note }) };
}
