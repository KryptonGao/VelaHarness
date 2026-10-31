import { useLayoutEffect, useRef, type RefObject } from "react";
import { tr, trf } from "../locale";
import { ChatIcon, FolderIcon } from "./icons";
import { positionSidePopover } from "./popover-position";

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
        <FolderIcon size={15} />
        <span className="workspace-hover-card-name">{name}</span>
        <button className="workspace-hover-card-pin" type="button" title={pinLabel} aria-label={`${pinLabel} · ${name}`}
          aria-pressed={pinned} onClick={onTogglePin}>
          <PinIcon filled={pinned} />
        </button>
      </div>
      <div className="workspace-hover-card-line"><ChatIcon size={15} /><span>{chatLabel}</span></div>
      <div className="workspace-hover-card-paths">
        <FolderIcon size={15} />
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
    <svg width="14" height="14" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 17v5" />
      <path d="M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6Z" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="8" cy="17" r="2" />
    </svg>
  );
}
