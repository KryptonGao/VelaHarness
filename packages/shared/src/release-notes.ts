import { appLocales, isAppLocale, type AppLocale } from "./i18n";

/**
 * 引导里的「新到港」与更新后的提示卡，内容来自随安装包发布的 `apps/desktop/release-notes.json`。
 * 这份文件单独维护，五种语言都写在里面，与 GitHub Release 正文（根目录 RELEASE_NOTES.md）互不相关。
 * 主进程读取安装包里的文件，渲染层只展示结果，所以离线可用，且一定对应当前已安装的版本。
 */
export interface ReleaseNoteItem {
  title: string;
  body: string;
}

/** 单一语言的内容：几条大纸条（highlights）加若干条小改进。 */
export interface ReleaseNotesText {
  summary: string;
  highlights: ReleaseNoteItem[];
  improvements: string[];
}

/** release-notes.json 的结构。 */
export interface ReleaseNotesFile {
  version: string;
  locales: Partial<Record<AppLocale, ReleaseNotesText>> & { en: ReleaseNotesText };
}

export interface ReleaseNotes extends ReleaseNotesText {
  version: string;
  /** 实际使用的语言；没有对应译文时回退到英文。 */
  locale: AppLocale;
}

export interface ReleaseNotesApi {
  /** 读取当前版本在指定语言下的发布说明；打包里没有或版本对不上时返回 null。 */
  get(locale: string): Promise<ReleaseNotes | null>;
  /** 在浏览器里打开该版本的 GitHub Release 页。 */
  openPage(): Promise<void>;
  /** 更新后首次打开时是否自动弹出「新到港」；开发版和自动化测试为 false，避免盖住界面。 */
  shouldAnnounce(): Promise<boolean>;
}

export const ReleaseNotesIpc = {
  get: "release-notes:get",
  openPage: "release-notes:open-page",
  shouldAnnounce: "release-notes:should-announce",
} as const;

function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNotesText(value: unknown): value is ReleaseNotesText {
  if (!value || typeof value !== "object") return false;
  const notes = value as Partial<ReleaseNotesText>;
  return text(notes.summary)
    && Array.isArray(notes.highlights) && notes.highlights.length > 0
    && notes.highlights.every((item) => !!item && text(item.title) && text(item.body))
    && Array.isArray(notes.improvements) && notes.improvements.every(text);
}

/** 校验 JSON 内容：版本号合法、英文必须存在；其他语言写坏了就当作没有，回退英文。 */
export function parseReleaseNotesFile(data: unknown): ReleaseNotesFile | null {
  if (!data || typeof data !== "object") return null;
  const file = data as { version?: unknown; locales?: unknown };
  if (typeof file.version !== "string" || !/^\d+\.\d+\.\d+/.test(file.version)) return null;
  const locales = file.locales as Record<string, unknown> | undefined;
  if (!locales || !isNotesText(locales.en)) return null;
  const valid: Partial<Record<AppLocale, ReleaseNotesText>> = {};
  for (const locale of appLocales) if (isNotesText(locales[locale])) valid[locale] = locales[locale] as ReleaseNotesText;
  return { version: file.version, locales: { ...valid, en: locales.en } };
}

/** 取指定语言的说明，没有就用英文。 */
export function selectReleaseNotes(file: ReleaseNotesFile, locale: unknown): ReleaseNotes {
  const wanted: AppLocale = isAppLocale(locale) && file.locales[locale] ? locale : "en";
  return { version: file.version, locale: wanted, ...file.locales[wanted]! };
}
