import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { it } from "node:test";
import type { BrowserWindow } from "electron";
import { restoreDefaultWindowSize } from "../src/main/window-size.ts";

class WindowStub extends EventEmitter {
  destroyed = false;
  fullscreen = false;
  maximized = false;
  size = [1600, 1000];
  calls: string[] = [];
  isDestroyed() { return this.destroyed; }
  isFullScreen() { return this.fullscreen; }
  isMaximized() { return this.maximized; }
  setFullScreen(value: boolean) { this.calls.push(`fullscreen:${value}`); }
  unmaximize() { this.calls.push("unmaximize"); }
  setSize(width: number, height: number) { this.size = [width, height]; this.calls.push("resize"); }
  resetSize() { restoreDefaultWindowSize(this as unknown as BrowserWindow); }
  leaveFullscreen() { this.fullscreen = false; this.emit("leave-full-screen"); }
  leaveMaximized() { this.maximized = false; this.emit("unmaximize"); }
}

it("restores a resized window to 1280 × 840 and is repeatable", () => {
  const win = new WindowStub();
  win.resetSize();
  assert.deepEqual(win.size, [1280, 840]);
  win.size = [1000, 700];
  win.resetSize();
  assert.deepEqual(win.size, [1280, 840]);
});

it("waits for native full-screen exit before resizing", () => {
  const win = new WindowStub();
  win.fullscreen = true;
  win.resetSize();
  assert.deepEqual(win.calls, ["fullscreen:false"]);
  assert.deepEqual(win.size, [1600, 1000]);
  win.leaveFullscreen();
  assert.deepEqual(win.size, [1280, 840]);
  assert.equal(win.listenerCount("leave-full-screen"), 0);
});

it("waits for unmaximizing before resizing", () => {
  const win = new WindowStub();
  win.maximized = true;
  win.resetSize();
  assert.deepEqual(win.calls, ["unmaximize"]);
  win.leaveMaximized();
  assert.deepEqual(win.calls, ["unmaximize", "resize"]);
  assert.deepEqual(win.size, [1280, 840]);
});

it("handles full screen entered from a maximized window", () => {
  const win = new WindowStub();
  win.fullscreen = win.maximized = true;
  win.resetSize();
  win.leaveFullscreen();
  assert.deepEqual(win.calls, ["fullscreen:false", "unmaximize"]);
  win.leaveMaximized();
  assert.deepEqual(win.size, [1280, 840]);
});

it("ignores windows closed before or during a transition", () => {
  const closed = new WindowStub();
  closed.destroyed = true;
  closed.resetSize();
  assert.deepEqual(closed.calls, []);

  for (const mode of ["fullscreen", "maximized"] as const) {
    const win = new WindowStub();
    win[mode] = true;
    win.resetSize();
    win.destroyed = true;
    if (mode === "fullscreen") win.leaveFullscreen();
    else win.leaveMaximized();
    assert.equal(win.calls.includes("resize"), false);
  }
});
