import { systemPromptProfiles, type SystemPromptProfile } from "@vela/shared";

export const promptPreferenceKey = "vela.systemPromptProfile";

/** An absent or unrecognized preference leaves startup selection to VELA_SYSTEM_PROMPT. */
export function readPromptPreference(storage: { getItem(key: string): string | null | undefined }): SystemPromptProfile | undefined {
  const value = storage.getItem(promptPreferenceKey);
  return systemPromptProfiles.find(profile => profile === value);
}
