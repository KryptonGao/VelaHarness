import { useLayoutEffect, useRef, type RefObject } from "react";
import { tr, trf } from "../locale";
import { positionSidePopover } from "./popover-position";
import { Icon } from "./icons";

/** 侧边栏工作区悬停信息卡:用原生 top layer 弹出,不被侧边栏滚动区裁切。 */
export function WorkspaceHoverCard({ anchor, name, cwd, folders, chatCount, pinned, onTogglePin, onEdit }: {
  anchor: RefObject<HTMLElement | null>;
  name: string;
  cwd: string;
  /** 主要文件夹之外的附加文件夹。 */
  folders: readonly string[];
  chatCount: number;
  pinned: boolean;
  onTogglePin: () => void;
  onEdit?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const card = ref.current;
    const trigger = anchor.current;
    if (!card || !trigger) return;
    card.showPopover();
    const update = () => {
      const position = positionSidePopover(trigger.getBoundingClientRect(),
        { width: card.offsetWidth, height: card.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight });
      card.style.left = `${position.left}px`;
      card.style.top = `${position.top}px`;
      card.dataset.side = position.side;
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(trigger);
    observer.observe(card);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      if (card.matches(":popover-open")) card.hidePopover();
    };
  }, [anchor]);

  const pinLabel = pinned ? tr("取消置顶工作区", "Unpin workspace") : tr("置顶工作区", "Pin workspace");
  const chatLabel = chatCount === 1 ? tr("1 次聊天", "1 chat") : trf("{0} 次聊天", "{0} chats", chatCount);
  return (
    <div ref={ref} popover="manual" role="group" aria-label={name} className="workspace-hover-card">
      <div className="workspace-hover-card-head">
        <Icon name="folder" size={16} />
        <span className="workspace-hover-card-name">{name}</span>
        <button className="workspace-hover-card-pin" type="button" title={pinLabel} aria-label={`${pinLabel} · ${name}`}
          aria-pressed={pinned} onClick={onTogglePin}>
          <PinIcon filled={pinned} />
        </button>
      </div>
      <div className="workspace-hover-card-line"><Icon name="chat" size={16} /><span>{chatLabel}</span></div>
      <div className="workspace-hover-card-paths">
        <Icon name="folder" size={16} />
        <div>
          <span className="workspace-hover-card-path" title={cwd}>{cwd}</span>
          {folders.map(folder => <span key={folder} className="workspace-hover-card-path" title={folder}>{folder}</span>)}
        </div>
      </div>
      {onEdit ? <button className="workspace-hover-card-edit" type="button" onClick={onEdit}>
        <EditIcon /><span>{tr("编辑工作区", "Edit workspace")}</span>
      </button> : null}
    </div>
  );
}

export function PinIcon({ filled = false }: { filled?: boolean }) {
  return (
    <Icon name="pin" size={14} filled={filled} />
  );
}

function EditIcon() {
  return (
    <Icon name="sliders" size={16} />
  );
}
