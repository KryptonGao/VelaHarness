import { tr } from "../locale";
import { modKeyLabel } from "../platform";
import { ArrowLeftIcon, ArrowRightIcon } from "./icons";

interface NavHistoryButtonsProps {
  platform: string;
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
}

/** 窗口左上角、红绿灯右侧的前进/后退按钮，在页面与对话之间像浏览器标签页一样来回。 */
export function NavHistoryButtons({ platform, canGoBack, canGoForward, onBack, onForward }: NavHistoryButtonsProps) {
  const mac = platform === "darwin";
  const back = tr("后退", "Back");
  const forward = tr("前进", "Forward");
  return <div className="nav-history-buttons" role="group" aria-label={tr("导航历史", "Navigation history")}>
    <button className="icon-btn-ghost" type="button" disabled={!canGoBack} onClick={onBack}
      title={`${back} (${mac ? `${modKeyLabel(platform)}[` : "Alt+←"})`} aria-label={back}>
      <ArrowLeftIcon size={15} />
    </button>
    <button className="icon-btn-ghost" type="button" disabled={!canGoForward} onClick={onForward}
      title={`${forward} (${mac ? `${modKeyLabel(platform)}]` : "Alt+→"})`} aria-label={forward}>
      <ArrowRightIcon size={15} />
    </button>
  </div>;
}
