import { useSyncExternalStore } from "react";
import { isFaviconUrl, isUiBrowserUrl, UI_BROWSER_BLANK_URL } from "../../browser-policy";
import { uiStorage } from "../ui-storage";

export interface BrowserFavorite { url: string; title: string; favicon?: string }

export const browserFavoritesStorageKey = "vela.browser.favorites";
const maxFavorites = 24;

const noFavorites: readonly BrowserFavorite[] = Object.freeze([]);

/** 读取失败或格式不对时回到空列表；同一网址只留第一条。 */
export function parseFavorites(raw: string | null | undefined): BrowserFavorite[] {
  if (!raw) return [];
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const favorites: BrowserFavorite[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const { url, title, favicon } = item as Record<string, unknown>;
    if (typeof url !== "string" || url === UI_BROWSER_BLANK_URL || !isUiBrowserUrl(url) || seen.has(url)) continue;
    seen.add(url);
    favorites.push({
      url,
      title: typeof title === "string" ? title : "",
      ...(typeof favicon === "string" && isFaviconUrl(favicon) ? { favicon } : {}),
    });
    if (favorites.length >= maxFavorites) break;
  }
  return favorites;
}

let current: readonly BrowserFavorite[] | null = null;
const listeners = new Set<() => void>();

function load(): readonly BrowserFavorite[] {
  if (current) return current;
  try { current = parseFavorites(uiStorage.getItem(browserFavoritesStorageKey)); }
  catch { current = noFavorites; }
  return current;
}

function save(next: readonly BrowserFavorite[]): void {
  current = next;
  try { uiStorage.setItem(browserFavoritesStorageKey, JSON.stringify(next)); }
  catch { /* 存不下就只在本次运行内保留 */ }
  for (const listener of listeners) listener();
}

export const browserFavorites = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  getSnapshot: load,
  has(url: string): boolean { return load().some(item => item.url === url); },
  /** 已收藏则取消，否则加到最前面；返回操作后是否处于收藏状态。 */
  toggle(favorite: BrowserFavorite): boolean {
    const list = load();
    if (list.some(item => item.url === favorite.url)) { save(list.filter(item => item.url !== favorite.url)); return false; }
    if (favorite.url === UI_BROWSER_BLANK_URL || !isUiBrowserUrl(favorite.url)) return false;
    save([favorite, ...list].slice(0, maxFavorites));
    return true;
  },
  remove(url: string): void { save(load().filter(item => item.url !== url)); },
  /** 打开页面时顺手更新已收藏条目的标题和图标，让首页保持最新。 */
  refresh(url: string, title: string, favicon: string | undefined): void {
    const list = load();
    const index = list.findIndex(item => item.url === url);
    if (index < 0) return;
    const previous = list[index];
    const next: BrowserFavorite = { url, title: title || previous.title, ...((favicon || previous.favicon) ? { favicon: favicon || previous.favicon } : {}) };
    if (next.title === previous.title && next.favicon === previous.favicon) return;
    save(list.map((item, i) => i === index ? next : item));
  },
};

export function useBrowserFavorites(): readonly BrowserFavorite[] {
  return useSyncExternalStore(browserFavorites.subscribe, browserFavorites.getSnapshot);
}
