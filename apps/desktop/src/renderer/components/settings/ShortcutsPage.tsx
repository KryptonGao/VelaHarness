import { useEffect, useMemo, useState } from "react";
import { tr, trf } from "../../locale";
import {
  bindingFromEvent,
  defaultBindings,
  findConflict,
  formatBinding,
  isCustomized,
  isReservedBinding,
  isUsableBinding,
  resetAllShortcuts,
  resetShortcut,
  resolveBindings,
  setShortcutBindings,
  setShortcutRecording,
  shortcutDefinitions,
  useShortcutOverrides,
  type ShortcutAction,
  type ShortcutDefinition,
  type ShortcutGroup,
} from "../../shortcuts";
import { PencilIcon, PlusIcon } from "../icons";
import type { SettingsCopy } from "../settings-copy";
import { SettingsGroup } from "./primitives";

const MAX_BINDINGS = 3;

const groupTitles: Record<ShortcutGroup, [string, string]> = {
  chat: ["聊天", "Chats"],
  navigation: ["导航", "Navigation"],
  workbench: ["标签页与工作台", "Tabs and workbench"],
  view: ["视图", "View"],
};
const groupOrder: ShortcutGroup[] = ["chat", "navigation", "workbench", "view"];

/** 正在录入的槽位:index 为 null 表示新增一个快捷键。 */
interface Recording { action: ShortcutAction; index: number | null }

/** 等待按键时的占位:和已设置的快捷键同款的小胶囊,里面一个呼吸的点,不放文字。 */
function ListeningPill() {
  return <kbd className="settings-key-listening" aria-hidden="true"><i /></kbd>;
}

const label = (definition: ShortcutDefinition) => tr(definition.label[0], definition.label[1]);

export function ShortcutsPage({ copy, platform }: { copy: SettingsCopy; platform: string }) {
  const text = copy.appearance;
  const overrides = useShortcutOverrides();
  const bindings = useMemo(() => resolveBindings(overrides, platform), [overrides, platform]);
  const [recording, setRecording] = useState<Recording | null>(null);
  const [problem, setProblem] = useState<{ action: ShortcutAction; message: string } | null>(null);
  const anyCustomized = shortcutDefinitions.some(definition => isCustomized(definition.action, overrides, platform));

  useEffect(() => {
    if (!recording) return;
    setShortcutRecording(true);
    const { action, index } = recording;
    const stop = () => { setRecording(null); };
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.isComposing || event.repeat) return;
      const noModifier = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
      if (event.key === "Escape" && noModifier) { setProblem(null); stop(); return; }
      const current = bindings[action];
      if ((event.key === "Backspace" || event.key === "Delete") && noModifier) {
        // 清除正在修改的这个快捷键;新增槽位上按删除只是取消。
        if (index !== null) setShortcutBindings(action, current.filter((_, position) => position !== index), platform);
        setProblem(null);
        stop();
        return;
      }
      const binding = bindingFromEvent(event, platform);
      if (!binding) return; // 只按下了修饰键,继续等待主键
      if (!isUsableBinding(binding)) {
        setProblem({ action, message: tr("快捷键需要包含 ⌘、Ctrl 或 Alt 修饰键。", "A shortcut needs a ⌘, Ctrl or Alt modifier.") });
        return;
      }
      if (isReservedBinding(binding)) {
        setProblem({ action, message: trf("{0} 由系统或编辑功能占用，请换一个。", "{0} is reserved for the system or text editing. Try another.", formatBinding(binding, platform)) });
        return;
      }
      const conflict = findConflict(binding, action, bindings);
      if (conflict) {
        const other = shortcutDefinitions.find(definition => definition.action === conflict);
        setProblem({ action, message: trf("{0} 已用于「{1}」，请先清除或换一个。", "{0} is already used by “{1}”. Clear it first or pick another.", formatBinding(binding, platform), other ? label(other) : conflict) });
        return;
      }
      const next = index === null ? [...current, binding] : current.map((existing, position) => position === index ? binding : existing);
      setShortcutBindings(action, [...new Set(next)], platform);
      setProblem(null);
      stop();
    };
    // 捕获阶段拦截,别让应用自己的快捷键先响应;失焦也结束录入。
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("blur", stop);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("blur", stop);
      setShortcutRecording(false);
    };
  }, [recording, bindings, platform]);

  const fixed = [
    { label: text.items.search, keys: [formatBinding("Mod+F", platform)] },
    { label: text.items.close, keys: ["Esc"] },
    { label: text.items.send, keys: ["Enter"] },
    { label: text.items.newline, keys: ["Shift", "Enter"] },
  ];

  return (
    <section className="settings-section">
      <div className="settings-shortcuts-intro" data-setting-id="shortcuts">
        <p className="settings-hint">{tr("点击快捷键即可修改，改动立即生效；录入时按 Esc 取消，按删除键清除该快捷键。", "Click a shortcut to change it. Changes apply right away; press Esc to cancel while recording, or Delete to clear it.")}</p>
        <button type="button" className="settings-shortcut-reset-all" disabled={!anyCustomized}
          onClick={() => { setRecording(null); setProblem(null); resetAllShortcuts(); }}>
          {tr("全部恢复默认", "Reset all to defaults")}
        </button>
      </div>
        {groupOrder.map(group => (
          <SettingsGroup key={group} title={tr(groupTitles[group][0], groupTitles[group][1])}>
              {shortcutDefinitions.filter(definition => definition.group === group).map(definition => {
                const { action } = definition;
                const current = bindings[action];
                const customized = isCustomized(action, overrides, platform);
                const error = problem?.action === action ? problem.message : null;
                return (
                  <div className="settings-shortcut-row" key={action} data-shortcut-action={action}>
                    <div className="settings-shortcut">
                      <span className="settings-shortcut-text">
                        <b>{label(definition)}</b>
                        <small>{tr(definition.hint[0], definition.hint[1])}</small>
                      </span>
                      <span className="settings-keys">
                        {current.length === 0 && recording?.action !== action ? <span className="settings-key-unassigned">{tr("未分配", "Unassigned")}</span> : null}
                        {current.map((binding, index) => {
                          const active = recording?.action === action && recording.index === index;
                          return (
                            <button type="button" className={`settings-key${active ? " is-recording" : ""}`} key={binding}
                              aria-label={active ? tr("按下新的快捷键", "Press new shortcut") : trf("修改快捷键 {0}", "Change shortcut {0}", formatBinding(binding, platform))}
                              onClick={() => { setProblem(null); setRecording(active ? null : { action, index }); }}>
                              {active ? <ListeningPill /> : <kbd>{formatBinding(binding, platform)}</kbd>}
                              {active ? null : <PencilIcon />}
                            </button>
                          );
                        })}
                        {recording?.action === action && recording.index === null ? (
                          <button type="button" className="settings-key is-recording" aria-label={tr("按下新的快捷键", "Press new shortcut")} onClick={() => setRecording(null)}>
                            <ListeningPill />
                          </button>
                        ) : current.length < MAX_BINDINGS ? (
                          <button type="button" className="settings-key settings-key-add"
                            aria-label={trf("为「{0}」添加快捷键", "Add a shortcut for “{0}”", label(definition))}
                            title={tr("添加快捷键", "Add shortcut")}
                            onClick={() => { setProblem(null); setRecording({ action, index: null }); }}>
                            <PlusIcon />
                          </button>
                        ) : null}
                        {customized ? (
                          <button type="button" className="settings-key settings-key-reset"
                            title={trf("恢复默认：{0}", "Restore default: {0}", defaultBindings(action, platform).map(binding => formatBinding(binding, platform)).join(" / ") || tr("未分配", "Unassigned"))}
                            onClick={() => { setRecording(null); setProblem(null); resetShortcut(action); }}>
                            {tr("恢复默认", "Reset")}
                          </button>
                        ) : null}
                      </span>
                    </div>
                    {error ? <p className="settings-shortcut-error" role="alert">{error}</p> : null}
                  </div>
                );
              })}
          </SettingsGroup>
        ))}
        <SettingsGroup title={tr("固定快捷键", "Fixed shortcuts")}>
            {fixed.map(shortcut => (
              <div className="settings-shortcut" key={shortcut.label}>
                <span className="settings-shortcut-text"><b>{shortcut.label}</b></span>
                <span className="settings-keys">
                  {shortcut.keys.map(key => <kbd key={key}>{key}</kbd>)}
                </span>
              </div>
            ))}
        </SettingsGroup>
    </section>
  );
}
