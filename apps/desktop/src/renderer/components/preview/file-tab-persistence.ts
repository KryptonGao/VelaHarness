import { useCallback, useState } from "react";
import { uiStorage } from "../../ui-storage";
import { createLogger } from "../../logger";

export interface PreviewFileDescriptor {
  id: string;
  path: string;
  name: string;
  dir: string;
}

type FileTabsByWorkspace = Record<string, PreviewFileDescriptor[]>;
type Storage = Pick<typeof uiStorage, "getItem" | "setItem">;
export const fileTabsStorageKey = "vela.filePreviewTabsByWorkspace";
const log = createLogger("file-preview");

function validPath(path: unknown): path is string {
  return typeof path === "string" && path.length > 0 && path.length <= 1024 && path === path.trim()
    && !/[\0\\\uD800-\uDFFF]/u.test(path) && !path.split("/").some(part => part === "." || part === "..")
    && !path.endsWith("/") && !/^[A-Za-z]:$/.test(path);
}

function readFileTabs(storage: Storage): FileTabsByWorkspace {
  const tabs: FileTabsByWorkspace = Object.create(null);
  try {
    const value: unknown = JSON.parse(storage.getItem(fileTabsStorageKey) ?? "null");
    if (!value || typeof value !== "object" || Array.isArray(value)) return tabs;
    for (const [workspace, paths] of Object.entries(value)) {
      if (!workspace || !Array.isArray(paths)) continue;
      const files = [...new Set(paths.filter(validPath))].map(path => {
        const segments = path.split("/").filter(Boolean);
        const name = segments.pop()!;
        return { id: path, path, name, dir: segments.join("/") };
      });
      if (files.length) tabs[workspace] = files;
    }
  } catch { /* Malformed or unavailable storage must not prevent opening previews. */ }
  return tabs;
}

function writeFileTabs(tabs: FileTabsByWorkspace, storage: Storage): void {
  const paths = Object.entries(tabs).flatMap(([workspace, files]) => {
    const valid = [...new Set(files.map(file => file.path).filter(validPath))];
    return workspace && valid.length ? [[workspace, valid] as const] : [];
  });
  try { storage.setItem(fileTabsStorageKey, JSON.stringify(Object.fromEntries(paths))); }
  catch (error) { log.error("failed to save open file tabs", error); }
}

export function createFileTabStore(storage: Storage = uiStorage) {
  let tabs = readFileTabs(storage);
  return {
    getTabs: () => tabs,
    update(workspace: string, change: (files: PreviewFileDescriptor[]) => PreviewFileDescriptor[]) {
      const before = Object.hasOwn(tabs, workspace) ? tabs[workspace] : [];
      const files = change(before);
      if (files === before || (!files.length && !before.length)) return tabs;
      const next: FileTabsByWorkspace = Object.assign(Object.create(null), tabs);
      if (files.length) next[workspace] = files;
      else delete next[workspace];
      tabs = next;
      // The empty key has no trusted root yet and cannot write to durable storage.
      if (workspace) writeFileTabs(tabs, storage);
      return tabs;
    },
  };
}

export function usePersistedFileTabs() {
  const [store] = useState(createFileTabStore);
  const [tabs, setTabs] = useState(store.getTabs);
  // Store explicit user mutations immediately, not in effect cleanup or a state updater.
  const update = useCallback((...args: Parameters<typeof store.update>) => setTabs(store.update(...args)), [store]);
  return [tabs, update] as const;
}
