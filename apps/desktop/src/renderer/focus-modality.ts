const KEYBOARD_FLAG = "keyboardFocus";

/**
 * Chromium 会在鼠标点中按钮后、再按任意键（Esc、快捷键、字母）时让该按钮匹配 :focus-visible，
 * 对话框关闭后的程序化 focus() 也一样，于是侧栏会话行等元素凭空冒出一圈蓝框。
 * 这里不信任浏览器的判断：默认不显示焦点环，只有用户按过 Tab / Shift+Tab 才给 <html> 打 data-keyboard-focus，
 * 样式据此画出非文本控件的焦点环；鼠标按下后清除。
 */
export function installFocusModality(doc: Document = document): () => void {
  const root = doc.documentElement;
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Tab") root.dataset[KEYBOARD_FLAG] = "";
  };
  const onPointerDown = () => { delete root.dataset[KEYBOARD_FLAG]; };
  doc.addEventListener("keydown", onKeyDown, true);
  doc.addEventListener("pointerdown", onPointerDown, true);
  return () => {
    doc.removeEventListener("keydown", onKeyDown, true);
    doc.removeEventListener("pointerdown", onPointerDown, true);
    delete root.dataset[KEYBOARD_FLAG];
  };
}
