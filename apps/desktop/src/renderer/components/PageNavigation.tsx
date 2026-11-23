import type { ReactNode, Ref } from "react";
import type { SidebarResize } from "../hooks/useSidebarResize";
import { Icon, type IconName } from "./icons";
import { SidebarResizeHandle } from "./SidebarResizeHandle";

export function PageColumns({ navigation, resize, children, className = "" }: {
  navigation: ReactNode; resize?: SidebarResize; children: ReactNode; className?: string;
}) {
  return <div className={`page-columns ${className}`}>
    {navigation}
    {resize && <SidebarResizeHandle target="left" resize={resize} />}
    {children}
  </div>;
}

export function PageNav({ title, label = title, className = "", navRef, children }: {
  title: string; label?: string; className?: string; navRef?: Ref<HTMLElement>; children: ReactNode;
}) {
  return <nav className={`page-nav autohide-scrollbar ${className}`} ref={navRef} aria-label={label}>
    <h1 className="page-nav-title">{title}</h1>
    {children}
  </nav>;
}

export function PageNavItem({ icon, label, active, onClick, trailing, disabled }: {
  icon: IconName; label: string; active: boolean; onClick: () => void; trailing?: ReactNode; disabled?: boolean;
}) {
  return <button type="button" className="page-nav-item" aria-current={active ? "page" : undefined}
    title={label} disabled={disabled} onClick={onClick}>
    <Icon name={icon} size={16} className="page-nav-icon" />
    <span>{label}</span>
    {trailing != null && <span className="page-nav-trailing">{trailing}</span>}
  </button>;
}
