import { appLocaleNames, appLocales } from "@vela/shared";
import { setSidebarItem, sidebarItemIds, useSidebarItems } from "../../hooks/useSidebarItems";
import type { AppLocale, InfoLayout, PreferencesApi } from "../../hooks/usePreferences";
import type { ConversationLinkTarget } from "../../browser/conversation-link-policy";
import { notificationSoundKinds, type NotifySound } from "../../notification-sounds";
import type { SettingsCopy } from "../settings-copy";
import { setStartPageStyle, startPageStyles, useStartPageStyle, type StartPageStyle } from "../../hooks/useStartPageStyle";
import { setHomePrompts, useHomePrompts } from "../../hooks/useHomePrompts";
import { plusUsageWindows, setUsageRingPrefs, useUsageRingPrefs, type PlusUsageWindow } from "../../hooks/useUsageRingPrefs";
import { Segmented, SettingsBlock, SettingsGroup, SettingsSwitch } from "./primitives";
import { SpeechSettings } from "./SpeechSettings";
import { ChromeImportBlock } from "./ChromeImportBlock";
import { SettingsSelect } from "./SettingsSelect";
import { filePreviewOpenModes, setFilePreviewOpenMode, useFilePreviewOpenMode, type FilePreviewOpenMode } from "../../hooks/useFilePreviewOpenMode";

export function InterfacePage({
  copy,
  preferences,
  onPreviewSound,
}: {
  copy: SettingsCopy;
  preferences: PreferencesApi;
  onPreviewSound: NotifySound;
}) {
  const {
    locale,
    setLocale,
    infoLayout,
    setInfoLayout,
    conversationLinkTarget,
    setConversationLinkTarget,
  } = preferences;
  const text = copy.appearance;
  const filePreviewOpenMode = useFilePreviewOpenMode();
  const filePreviewOpenModeLabels: Record<FilePreviewOpenMode, string> = {
    "new-tab": text.filePreviewOpenModeNewTab,
    "current-tab": text.filePreviewOpenModeCurrentTab,
  };
  const startPageStyle = useStartPageStyle();
  const startPageStyleLabels: Record<StartPageStyle, string> = {
    atelier: text.startPageStyleAtelier,
    deck: text.startPageStyleDeck,
    classic: text.startPageStyleClassic,
    minimal: text.startPageStyleMinimal,
  };
  const startPageStyleHints: Record<StartPageStyle, string> = {
    atelier: text.startPageStyleAtelierHint,
    deck: text.startPageStyleDeckHint,
    classic: text.startPageStyleClassicHint,
    minimal: text.startPageStyleMinimalHint,
  };
  const homePrompts = useHomePrompts();
  const sidebarItems = useSidebarItems();
  const usageRing = useUsageRingPrefs();
  const plusWindowLabels: Record<PlusUsageWindow, string> = {
    lowest: text.usageRingLowest, "5h": text.usageRingFiveHour, "1w": text.usageRingWeekly,
  };
  const soundLabels = {
    error: text.soundError, complete: text.soundComplete,
    question: text.soundQuestion, permission: text.soundPermission,
  };
  const languages: { id: AppLocale; label: string }[] = appLocales.map(id => ({ id, label: appLocaleNames[id] }));
  const infoLayoutOptions: { id: InfoLayout; label: string }[] = [
    { id: "sidebar", label: text.infoLayoutSidebar },
    { id: "floating", label: text.infoLayoutFloating },
    { id: "cards", label: text.infoLayoutCards },
  ];
  const infoLayoutHints: Record<InfoLayout, string> = {
    sidebar: text.infoLayoutSidebarHint,
    floating: text.infoLayoutFloatingHint,
    cards: text.infoLayoutCardsHint,
  };
  const conversationLinkOptions: { id: ConversationLinkTarget; label: string }[] = [
    { id: "embedded", label: text.linkEmbedded },
    { id: "external", label: text.linkExternal },
  ];

  return (
    <section className="settings-section">
      <SettingsGroup title={copy.sections.general}>
        <SettingsBlock id="language" title={text.language} layout="inline">
          <SettingsSelect
            label={text.language}
            value={locale}
            options={languages.map(language => ({ value: language.id, label: language.label }))}
            onChange={value => setLocale(value as AppLocale)}
          />
        </SettingsBlock>
        <SettingsBlock id="sound-effects" title={text.soundEffects} hint={text.soundEffectsHint} layout="inline">
          <SettingsSwitch label={text.soundEffects} checked={preferences.soundEffects} onChange={preferences.setSoundEffects} />
        </SettingsBlock>
        {preferences.soundEffects ? (
          <SettingsBlock title={text.soundPreview} layout="inline">
            <div className="settings-actions" role="group" aria-label={text.soundPreview}>
              {notificationSoundKinds.map(sound => (
                <button key={sound} type="button" className="settings-secondary" onClick={() => onPreviewSound(sound)}>
                  {soundLabels[sound]}
                </button>
              ))}
            </div>
          </SettingsBlock>
        ) : null}
        <SpeechSettings />
        <SettingsBlock id="conversation-link-target" title={text.conversationLinkTarget} hint={text.conversationLinkHint} layout="inline">
          <Segmented label={text.conversationLinkTarget} value={conversationLinkTarget}
            options={conversationLinkOptions} onChange={setConversationLinkTarget} />
        </SettingsBlock>
        <ChromeImportBlock text={copy.chromeImport} />
        <SettingsBlock id="file-preview-open-mode" title={text.filePreviewOpenMode} hint={text.filePreviewOpenModeHint} layout="inline">
          <Segmented label={text.filePreviewOpenMode} value={filePreviewOpenMode}
            options={filePreviewOpenModes.map(id => ({ id, label: filePreviewOpenModeLabels[id] }))} onChange={setFilePreviewOpenMode} />
        </SettingsBlock>
      </SettingsGroup>
      <SettingsGroup title={copy.sections.experimental}>
        <SettingsBlock id="race" title={text.race} hint={text.raceHint} layout="inline">
          <SettingsSwitch label={text.race} checked={preferences.raceEnabled} onChange={preferences.setRaceEnabled} />
        </SettingsBlock>
        <SettingsBlock id="workbench-split" title={text.workbenchSplit} hint={text.workbenchSplitHint} layout="inline">
          <SettingsSwitch label={text.workbenchSplit} checked={preferences.workbenchSplit} onChange={preferences.setWorkbenchSplit} />
        </SettingsBlock>
        <SettingsBlock id="elastic-scroll" title={text.elasticScroll} hint={text.elasticScrollHint} layout="inline">
          <SettingsSwitch label={text.elasticScroll} checked={preferences.elasticScroll} onChange={preferences.setElasticScroll} />
        </SettingsBlock>
      </SettingsGroup>
      <SettingsGroup title={copy.sections.navLayout}>
        <SettingsBlock id="info-layout" title={text.infoLayout} hint={text.infoLayoutHint} extraHint={infoLayoutHints[infoLayout]} layout="inline">
          <Segmented menu label={text.infoLayout} value={infoLayout} options={infoLayoutOptions} onChange={setInfoLayout} />
        </SettingsBlock>
        <SettingsBlock id="sidebar-items" title={text.sidebarItems} hint={text.sidebarItemsHint}>
          {sidebarItemIds.map(id => (
            <div key={id} className="settings-switch-row">
              <span>{text.sidebarItemLabels[id]}</span>
              <SettingsSwitch
                checked={sidebarItems[id]}
                label={text.sidebarItemLabels[id]}
                onChange={next => setSidebarItem(id, next)}
              />
            </div>
          ))}
        </SettingsBlock>
        <SettingsBlock id="usage-ring" title={text.usageRing} hint={text.usageRingHint} layout="inline">
          <SettingsSwitch label={text.usageRing} checked={usageRing.enabled} onChange={enabled => setUsageRingPrefs({ enabled })} />
        </SettingsBlock>
        <SettingsBlock id="usage-ring-plus-window" title={text.usageRingPlusWindow} layout="inline">
          <SettingsSelect label={text.usageRingPlusWindow} value={usageRing.plusWindow} disabled={!usageRing.enabled}
            options={plusUsageWindows.map(value => ({ value, label: plusWindowLabels[value] }))}
            onChange={value => setUsageRingPrefs({ plusWindow: value as PlusUsageWindow })} />
        </SettingsBlock>
        <SettingsBlock id="start-page-style" title={text.startPageStyle} hint={text.startPageStyleHint} extraHint={startPageStyleHints[startPageStyle]} layout="inline">
          <Segmented
            menu
            label={text.startPageStyle}
            value={startPageStyle}
            options={startPageStyles.map(id => ({ id, label: startPageStyleLabels[id] }))}
            onChange={setStartPageStyle}
          />
        </SettingsBlock>
        <SettingsBlock id="home-prompts" title={text.homePrompts} hint={text.homePromptsHint} layout="inline">
          <SettingsSwitch label={text.homePrompts} checked={homePrompts} onChange={setHomePrompts} />
        </SettingsBlock>
      </SettingsGroup>
    </section>
  );
}
