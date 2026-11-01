import type { ReactNode } from "react";
import { Opt } from "./onboarding-ui";

/**
 * 布局选项的线框小图。只用引导自己的色纸色，不读应用主题；全部是装饰，读屏只读标题和说明。
 * 小图的样式在 onboarding.css 的 `.ob-lay` 一节。
 */
export type InfoLayoutKind = "sidebar" | "floating" | "cards";
export type NavLayoutKind = "classic" | "rail";
export type ComposerLayoutKind = "classic" | "calm" | "capsule";

export function InfoPreview({ kind, chat, info }: { kind: InfoLayoutKind; chat: string; info: string }) {
  return (
    <span className={`ob-lay info ${kind}`} aria-hidden="true">
      <span className="a" /><span className="b">{chat}</span>
      {kind === "cards"
        ? <><i className="k k1" /><i className="k k2" /><i className="k k3" /></>
        : <span className="c">{info}</span>}
    </span>
  );
}

export function NavPreview({ kind, chat }: { kind: NavLayoutKind; chat: string }) {
  return (
    <span className={`ob-lay nav ${kind}`} aria-hidden="true">
      {kind === "rail" ? <span className="rail"><i /><i /><i /><i /></span> : null}
      <span className="side"><i /><i /><i /></span>
      <span className="b">{chat}</span>
    </span>
  );
}

export function ComposerPreview({ kind, chat }: { kind: ComposerLayoutKind; chat: string }) {
  return (
    <span className={`ob-lay cmp ${kind}`} aria-hidden="true">
      <span className="b">{chat}</span>
      {kind === "capsule"
        ? <><span className="pill"><i /></span><span className="tray"><i /><i /><i /></span></>
        : <span className="box"><em />{kind === "classic" ? <span className="chips"><i /><i /><i /></span> : null}<i className="go" /></span>}
      {kind === "calm" ? <span className="foot"><i /></span> : null}
    </span>
  );
}

/** 带线框图的选项卡：标题、一句说明，下面是小图。 */
export function LayoutOption({ selected, title, hint, onPick, children }: {
  selected: boolean;
  title: string;
  hint: string;
  onPick: () => void;
  children: ReactNode;
}) {
  return (
    <Opt selected={selected} onClick={onPick} className="pick">
      <b>{title}</b><span>{hint}</span>
      {children}
    </Opt>
  );
}
