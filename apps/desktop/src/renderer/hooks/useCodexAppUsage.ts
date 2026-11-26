import { useEffect, useState } from "react";
import { codexUsageEnabledKey, type CodexUsageReport } from "@vela/shared";
import { isBoolean, readStoredState } from "./useStoredState";
import { uiStorage } from "../ui-storage";

const empty: CodexUsageReport = { buckets: [], incompleteFiles: 0 };

export function useCodexAppUsage() {
  const [enabled, setEnabled] = useState(() => readStoredState(codexUsageEnabledKey, false, isBoolean));
  const [report, setReport] = useState(empty);
  const [loading, setLoading] = useState(enabled);
  const [failed, setFailed] = useState(false);
  const [warningDismissed, setWarningDismissed] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let pending = false;
    const sync = async () => {
      if (pending) return;
      pending = true;
      setLoading(true);
      try {
        const next = await window.vela!.getCodexAppUsage();
        if (active) {
          setReport(next);
          setFailed(false);
          setWarningDismissed(false);
        }
      } catch {
        if (active) setFailed(true);
      } finally {
        pending = false;
        if (active) setLoading(false);
      }
    };
    void sync();
    const refreshVisible = () => { if (!document.hidden) void sync(); };
    const timer = window.setInterval(refreshVisible, 60_000);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [enabled, revision]);
  const toggle = (next: boolean) => {
    try {
      uiStorage.setItem(codexUsageEnabledKey, JSON.stringify(next));
      setEnabled(next);
      setLoading(next);
      setFailed(false);
      setReport(empty);
    } catch { setFailed(true); }
  };
  return {
    enabled, toggle, report, loading, failed, refresh: () => setRevision(n => n + 1),
    showIncompleteWarning: report.incompleteFiles > 0 && !warningDismissed,
    dismissIncompleteWarning: () => setWarningDismissed(true),
  };
}

