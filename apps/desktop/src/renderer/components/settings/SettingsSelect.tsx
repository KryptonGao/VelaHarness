import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { trf } from "../../locale";
import { Icon } from "../icons";

export interface SelectOption {
  value: string;
  label: string;
  /** 显示在选项名称下方的说明(灰色小字),可省略。 */
  description?: string;
  disabled?: boolean;
  /** 连续相同 group 的选项归在同一个小标题下。 */
  group?: string;
}

type SettingsSelectProps = {
  label: string;
  options: readonly SelectOption[];
  disabled?: boolean;
  describedBy?: string;
} & (
  | { multiple?: false; value: string; onChange: (value: string) => void }
  | { multiple: true; value: readonly string[]; onToggle: (value: string) => void }
);

const gap = 6;
const viewportMargin = 12;

/**
 * 设置页用的下拉框:触发按钮 + 浮出的选项列表。
 * 选中项在右侧画勾,鼠标悬停(或键盘移动到)的选项底色变灰;列表挂在 body 下,不会被卡片裁掉。
 */
export function SettingsSelect(props: SettingsSelectProps) {
  const { label, options, disabled, describedBy } = props;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [position, setPosition] = useState<{ top: number; left: number; minWidth: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const optionId = (index: number) => `${listId}-${index}`;
  const isSelected = (option: SelectOption) => props.multiple
    ? props.value.includes(option.value)
    : option.value === props.value;
  const valueLabel = props.multiple && props.value.length > 1
    ? trf("已选 {0} 项", "{0} selected", props.value.length)
    : options.find(isSelected)?.label ?? (props.multiple ? props.value[0] : "");

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  /** 鼠标点开时不高亮任何项(已选项只打勾,不变灰);键盘打开时高亮已选项,方便从它开始移动。 */
  const openMenu = (withKeyboard: boolean) => {
    if (disabled) return;
    const selected = options.findIndex((option) => isSelected(option) && !option.disabled);
    setActive(withKeyboard ? (selected >= 0 ? selected : options.findIndex((option) => !option.disabled)) : -1);
    setOpen(true);
  };

  // 量出列表尺寸后贴着触发按钮右缘放置;下方放不下就翻到上方。
  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.max(menu.offsetWidth, rect.width);
    const height = menu.offsetHeight;
    const below = rect.bottom + gap;
    const top = below + height > window.innerHeight - viewportMargin && rect.top - gap - height >= viewportMargin
      ? rect.top - gap - height
      : below;
    const left = Math.min(Math.max(viewportMargin, rect.right - width), window.innerWidth - width - viewportMargin);
    setPosition({ top, left, minWidth: rect.width });
  }, [open, valueLabel]);

  useEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false);
    };
    // 页面滚动或窗口缩放后位置会过期,直接收起。
    const onDismiss = (event: Event) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      close(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("scroll", onDismiss, true);
    window.addEventListener("resize", onDismiss);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", onDismiss, true);
      window.removeEventListener("resize", onDismiss);
    };
  }, [open, close]);

  // The menu can receive keyboard focus once it has been positioned and made visible.
  const menuPositioned = open && position !== null;
  useEffect(() => {
    if (!menuPositioned) return;
    menuRef.current?.focus({ preventScroll: true });
    menuRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [menuPositioned]);

  useEffect(() => {
    if (!open || active < 0) return;
    document.getElementById(optionId(active))?.scrollIntoView({ block: "nearest" });
    // optionId 只依赖 listId
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active]);

  const move = (direction: 1 | -1, from = active) => {
    // 没有高亮项时,向上从最后一项开始,向下从第一项开始
    const start = from < 0 && direction === -1 ? 0 : from;
    for (let step = 1; step <= options.length; step += 1) {
      const index = (start + direction * step + options.length * step) % options.length;
      if (!options[index].disabled) return setActive(index);
    }
  };

  const pick = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    if (props.multiple) {
      props.onToggle(option.value);
      setActive(index);
      menuRef.current?.focus({ preventScroll: true });
      return;
    }
    if (option.value !== props.value) props.onChange(option.value);
    close(true);
  };

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openMenu(true);
    }
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case "ArrowDown": event.preventDefault(); move(1); break;
      case "ArrowUp": event.preventDefault(); move(-1); break;
      case "Home": event.preventDefault(); move(1, -1); break;
      case "End": event.preventDefault(); move(-1, options.length); break;
      case "Enter":
      case " ": event.preventDefault(); if (active >= 0) pick(active); break;
      case "Escape": event.preventDefault(); event.stopPropagation(); close(true); break;
      case "Tab": close(false); break;
      default:
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="settings-select settings-select-trigger"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-describedby={describedBy}
        disabled={disabled}
        onClick={(event) => (open ? close(false) : openMenu(event.detail === 0))}
        onKeyDown={onTriggerKeyDown}
      >
        <span className="settings-select-value">{valueLabel}</span>
      </button>
      {open ? createPortal(
        <div
          ref={menuRef}
          id={listId}
          className="settings-menu"
          role="listbox"
          aria-label={label}
          aria-multiselectable={props.multiple || undefined}
          aria-activedescendant={active >= 0 ? optionId(active) : undefined}
          tabIndex={-1}
          style={position ? { top: position.top, left: position.left, minWidth: position.minWidth } : { top: 0, left: 0, visibility: "hidden" }}
          onKeyDown={onMenuKeyDown}
        >
          {options.map((option, index) => (
            <Fragment key={`${option.group ?? ""}/${option.value}`}>
              {option.group && option.group !== options[index - 1]?.group ? (
                <div className="settings-menu-group" role="presentation">{option.group}</div>
              ) : null}
              <div
                id={optionId(index)}
                className="settings-menu-item"
                role="option"
                aria-selected={isSelected(option)}
                aria-disabled={option.disabled || undefined}
                data-active={index === active ? "true" : undefined}
                onPointerEnter={() => { if (!option.disabled) setActive(index); }}
                onClick={() => pick(index)}
              >
                <span className="settings-menu-text">
                  <span className="settings-menu-label">{option.label}</span>
                  {option.description ? <span className="settings-menu-desc">{option.description}</span> : null}
                </span>
                {isSelected(option) ? <span className="settings-menu-check"><Icon name="check" size={16} /></span> : null}
              </div>
            </Fragment>
          ))}
        </div>,
        document.body,
      ) : null}
    </>
  );
}
