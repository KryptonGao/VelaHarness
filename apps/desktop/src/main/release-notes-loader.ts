import { readFile } from "node:fs/promises";
import { parseReleaseNotesFile, selectReleaseNotes, type ReleaseNotes } from "@vela/shared";

/**
 * 读取安装包里的 release-notes.json 并取指定语言。文件缺失、损坏，
 * 或其中的版本与当前应用不符时返回 null——宁可不显示，也不把别的版本的说明当成这一版。
 */
export async function loadReleaseNotes(
  file: string,
  locale: unknown,
  appVersion: string,
  read: (file: string) => Promise<string> = (path) => readFile(path, "utf8"),
): Promise<ReleaseNotes | null> {
  try {
    const parsed = parseReleaseNotesFile(JSON.parse(await read(file)));
    return parsed && parsed.version === appVersion ? selectReleaseNotes(parsed, locale) : null;
  } catch {
    return null;
  }
}
