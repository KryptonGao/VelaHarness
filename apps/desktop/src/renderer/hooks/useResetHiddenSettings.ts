import type { PreferencesApi } from "./usePreferences";
import { setCombinedModePicker, useCombinedModePicker } from "./useCombinedModePicker";
import { setCombinedModelPicker, useCombinedModelPicker } from "./useCombinedModelPicker";
import { setNavLayout, useNavLayout } from "./useNavLayout";
import { setPreviewBreadcrumbMode, usePreviewBreadcrumbMode } from "./usePreviewBreadcrumbMode";
import { setUnifiedIcons, useUnifiedIcons } from "./useUnifiedIcons";
import { setVersionControlLayout, useVersionControlLayout } from "./useVersionControlLayout";
import { resetHiddenUsageRingPrefs } from "./useUsageRingPrefs";
import { setUiInspectorEnabled, uiInspectorPreference } from "../components/intelligent-ui/ui-metrics-instance";
import { defaultUnfocusedGlassIncrease } from "../glass-opacity";
import { defaultThinkingActivityDelayMs } from "../thinking-activity-delay";
import { defaultCommandDetailHeight, defaultThinkingGroupHeight, defaultToolDetailHeight } from "../thinking-group-height";
import { uiStorage } from "../ui-storage";

/** Only the preferences simplified in 1.3.1. Use their live owners rather than reloading an active chat. */
export function useResetHiddenSettings(p: PreferencesApi) {
  const unifiedIcons = useUnifiedIcons();
  const navLayout = useNavLayout();
  const vcLayout = useVersionControlLayout();
  const breadcrumbs = usePreviewBreadcrumbMode();
  const combinedMode = useCombinedModePicker();
  const combinedModel = useCombinedModelPicker();

  return () => {
    const undo: (() => void)[] = [];
    function reset<T>(current: T, fallback: NoInfer<T>, set: (value: T) => void) {
      if (current === fallback) return;
      set(fallback);
      undo.push(() => set(current));
    }

    // These two controls no longer have a live owner. A tombstone prevents legacy re-import.
    for (const [key, fallback] of [["vela.composerLayout", '"capsule"'], ["vela.sendButtonIcon", "arrow-up"]] as const) {
      const saved = uiStorage.getItem(key);
      if (saved !== null && saved !== fallback) {
        uiStorage.removeItem(key);
        undo.push(() => uiStorage.setItem(key, saved));
      }
    }
    const undoRing = resetHiddenUsageRingPrefs();
    if (undoRing) undo.push(undoRing);

    reset(p.glassTint, "neutral", p.setGlassTint);
    reset(p.glassOpacity, null, p.setGlassOpacity);
    reset(p.unfocusedGlassMode, "absolute", p.setUnfocusedGlassMode);
    reset(p.unfocusedGlassIncrease, defaultUnfocusedGlassIncrease, p.setUnfocusedGlassIncrease);
    reset(p.sidebarCardGlass, true, p.setSidebarCardGlass);
    reset(unifiedIcons, false, setUnifiedIcons);

    reset(navLayout, "rail", setNavLayout);
    reset(vcLayout, "classic", setVersionControlLayout);
    reset(p.conversationWorkbenchTabs, true, p.setConversationWorkbenchTabs);
    reset(p.borderlessInterface, true, p.setBorderlessInterface);
    reset(breadcrumbs, "scroll", setPreviewBreadcrumbMode);
    reset(combinedMode, true, setCombinedModePicker);
    reset(combinedModel, true, setCombinedModelPicker);
    reset(p.composerCapsules, false, p.setComposerCapsules);

    reset(p.toolDisplay, "compact", p.setToolDisplay);
    reset(p.toolFold, "none", p.setToolFold);
    reset(p.toolIconColor, "gray", p.setToolIconColor);
    reset(p.toolProcessDetails, false, p.setToolProcessDetails);
    reset(p.showChangeSummary, true, p.setShowChangeSummary);
    reset(p.minimalMode, false, p.setMinimalMode);
    reset(p.filePath, false, p.setFilePath);
    reset(p.thinkingSummaryStyle, "prose", p.setThinkingSummaryStyle);
    reset(p.thinkingGroupMode, "codex", p.setThinkingGroupMode);
    reset(p.thinkingActivityDelayEnabled, true, p.setThinkingActivityDelayEnabled);
    reset(p.thinkingActivityDelayMs, defaultThinkingActivityDelayMs, p.setThinkingActivityDelayMs);
    reset(p.thinkingTitleStyle, "normal-muted", p.setThinkingTitleStyle);
    reset(p.thinkingGroupHeight, defaultThinkingGroupHeight, p.setThinkingGroupHeight);
    reset(p.commandDetailHeight, defaultCommandDetailHeight, p.setCommandDetailHeight);
    reset(p.toolDetailHeight, defaultToolDetailHeight, p.setToolDetailHeight);
    reset(p.toolDetailHeightScale, true, p.setToolDetailHeightScale);
    reset(p.thinkingGroupHeightGrow, true, p.setThinkingGroupHeightGrow);
    reset(p.replyFade, true, p.setReplyFade);
    reset(p.thinkingFade, true, p.setThinkingFade);
    reset(p.replyPop, false, p.setReplyPop);
    reset(p.thinkingPop, false, p.setThinkingPop);
    reset(uiInspectorPreference(), false, setUiInspectorEnabled);

    return undo.length ? () => { for (const restore of undo) restore(); } : null;
  };
}
