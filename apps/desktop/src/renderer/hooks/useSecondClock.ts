import { useEffect, useState } from "react";
import { secondClock } from "../second-clock";

/** 每秒刷新的当前时间；`active` 为 false 时不订阅。所有调用方共用同一个定时器。 */
export function useSecondClock(active = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    return secondClock.subscribe(setNow);
  }, [active]);
  return now;
}
