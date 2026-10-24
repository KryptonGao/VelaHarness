import { useCallback, useSyncExternalStore } from "react";
import { tr } from "../locale";
import { OrbCanvas } from "./OrbCanvas";
import type { OrbActivity } from "./jump-orb";
import { sharedOrbStyles } from "./orb-style-store";

/**
 * 行内的运行中指示器,和「回到最新」圆球共用同一套动效:
 * 思考用三点样式,工具调用和子代理运行用四点样式;样式按轮换规则定时更换,换的时候点平滑过渡。
 */
export function ActivityIndicator({ label = tr("运行中", "Running"), activity = "command" }: { label?: string; activity?: OrbActivity }) {
  // subscribe 的引用必须稳定:每次渲染都换新函数会让 React 退订再订阅,样式轮换的计时被反复清零,父组件每秒刷新时样式就永远不换。
  const subscribe = useCallback((listener: () => void) => sharedOrbStyles.subscribe(activity, listener), [activity]);
  const style = useSyncExternalStore(subscribe, () => sharedOrbStyles.get(activity));
  return (
    <span className="tool-activity-loader" role="status" aria-label={label}>
      <OrbCanvas style={style} running visible className="orb-indicator" viewBox="4.5 4.5 21 21" />
    </span>
  );
}
