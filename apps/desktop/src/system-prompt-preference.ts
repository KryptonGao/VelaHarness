import { systemPromptProfiles, type SystemPromptProfile } from "@vela/shared";

export const promptPreferenceKey = "vela.systemPromptProfile";
export const globalPromptPreferenceKey = "vela.globalPrompt";
export const maxGlobalPromptLength = 16_000;

export function parseGlobalPrompt(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value !== "string" || value.length > maxGlobalPromptLength) {
    throw new Error("Invalid global prompt");
  }
  return value.trim();
}

/** An absent or unrecognized preference leaves startup selection to VELA_SYSTEM_PROMPT. */
export function readPromptPreference(storage: { getItem(key: string): string | null | undefined }): SystemPromptProfile | undefined {
  const value = storage.getItem(promptPreferenceKey);
  return systemPromptProfiles.find(profile => profile === value);
}
