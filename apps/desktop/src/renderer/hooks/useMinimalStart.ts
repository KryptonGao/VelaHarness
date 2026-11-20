import { setStartPageStyle, useStartPageStyle } from "./useStartPageStyle";

/** 兼容旧版极简起始页入口，底层统一由 startPageStyle 管理。 */
export function setMinimalStart(enabled: boolean) {
  setStartPageStyle(enabled ? "minimal" : "atelier");
}

export function useMinimalStart(): boolean {
  return useStartPageStyle() === "minimal";
}
