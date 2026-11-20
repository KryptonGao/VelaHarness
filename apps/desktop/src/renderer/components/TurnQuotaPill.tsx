import { consumedText, quotaWindowName, type TurnQuotaWindow } from "./turn-quota";

/** 本轮对话消耗的额度：一颗小胶囊，每个窗口一项（如「5h 3%  1w 1%」）。 */
export function TurnQuotaPill({ windows }: { windows: readonly TurnQuotaWindow[] }) {
  if (windows.length === 0) return null;
  return (
    <span className="turn-quota">
      {windows.map((window) => (
        <span className="turn-quota-item" key={window.windowMinutes}>
          <span className="turn-quota-name">{quotaWindowName(window.windowMinutes)}</span>
          <span>{consumedText(window.consumedPercent)}</span>
        </span>
      ))}
    </span>
  );
}
