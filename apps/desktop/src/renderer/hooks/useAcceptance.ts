import { useCallback, useState } from "react";
import type { AcceptanceRequest } from "../components/acceptance";
import { turnReviewScope } from "../turn-review-state";

/** 验收标签只保存在内存中，每个工作区和聊天各持有一个快照。 */
export function useAcceptance(workspace: string, conversation: string) {
  const [requests, setRequests] = useState<Record<string, AcceptanceRequest>>({});
  const scope = turnReviewScope(workspace, conversation);
  const open = useCallback((request: AcceptanceRequest) => {
    setRequests(current => current[scope]?.turnId === request.turnId ? current : {
      ...current, [scope]: structuredClone(request),
    });
  }, [scope]);
  const close = useCallback(() => setRequests(current => {
    if (!(scope in current)) return current;
    const next = { ...current };
    delete next[scope];
    return next;
  }), [scope]);
  return { acceptance: requests[scope] ?? null, tabId: `acceptance:${encodeURIComponent(scope)}`, open, close };
}
