import type { BrowserWindow } from "electron";

export const DEFAULT_WINDOW_SIZE = { width: 1280, height: 840 } as const;

export function restoreDefaultWindowSize(win: BrowserWindow): void {
  if (win.isDestroyed()) return;

  // macOS leaves native full screen asynchronously; resize after the transition.
  if (win.isFullScreen()) {
    win.once("leave-full-screen", () => restoreDefaultWindowSize(win));
    win.setFullScreen(false);
    return;
  }

  const resize = () => {
    if (!win.isDestroyed()) win.setSize(DEFAULT_WINDOW_SIZE.width, DEFAULT_WINDOW_SIZE.height);
  };
  if (win.isMaximized()) {
    win.once("unmaximize", resize);
    win.unmaximize();
  } else {
    resize();
  }
}
