import assert from "node:assert/strict";
import test from "node:test";
import { installFocusModality } from "../src/renderer/focus-modality.ts";

function fakeDocument() {
  const listeners = new Map<string, (event: unknown) => void>();
  const dataset: Record<string, string> = {};
  const doc = {
    documentElement: { dataset },
    addEventListener: (type: string, fn: (event: unknown) => void) => { listeners.set(type, fn); },
    removeEventListener: (type: string) => { listeners.delete(type); },
  };
  return { doc: doc as unknown as Document, dataset, fire: (type: string, event: unknown = {}) => listeners.get(type)?.(event), listeners };
}

test("默认不显示焦点环，只有 Tab 打标记，鼠标按下清除", () => {
  const { doc, dataset, fire } = fakeDocument();
  installFocusModality(doc);
  assert.equal("keyboardFocus" in dataset, false);

  for (const key of ["Escape", "a", "Enter", "Meta", "ArrowDown", "Home"]) {
    fire("keydown", { key });
    assert.equal("keyboardFocus" in dataset, false, `${key} 不应打标记`);
  }

  fire("keydown", { key: "Tab" });
  assert.equal("keyboardFocus" in dataset, true);

  fire("keydown", { key: "Enter" });
  assert.equal("keyboardFocus" in dataset, true, "Tab 之后按 Enter/空格不应让焦点环消失");

  fire("pointerdown");
  assert.equal("keyboardFocus" in dataset, false);
});

test("卸载时移除监听并清掉标记", () => {
  const { doc, dataset, fire, listeners } = fakeDocument();
  const dispose = installFocusModality(doc);
  fire("keydown", { key: "Tab" });
  dispose();
  assert.equal("keyboardFocus" in dataset, false);
  assert.equal(listeners.size, 0);
});
