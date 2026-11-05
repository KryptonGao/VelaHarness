import { appLocaleNames, appLocales } from "@vela/shared";
import { navLayouts, setNavLayout, useNavLayout, type NavLayout } from "../../hooks/useNavLayout";
import { setSidebarItem, sidebarItemIds, useSidebarItems } from "../../hooks/useSidebarItems";
import type { AppLocale, InfoLayout, PreferencesApi } from "../../hooks/usePreferences";
import type { ConversationLinkTarget } from "../../browser/conversation-link-policy";
import { notificationSoundKinds, type NotifySound } from "../../notification-sounds";
import type { SettingsCopy } from "../settings-copy";
import { setMinimalStart, useMinimalStart } from "../../hooks/useMinimalStart";
import { composerLayouts, setComposerLayout, useComposerLayout, type ComposerLayout } from "../../hooks/useComposerLayout";
import { Segmented, SettingsBlock, SettingsGroup, SettingsSwitch } from "./primitives";
import { SettingsSelect } from "./SettingsSelect";

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
    composerCapsules,
    setComposerCapsules,
    sendButtonIcon,
    setSendButtonIcon,
  } = preferences;
  const text = copy.appearance;
  const composerLayout = useComposerLayout();
  const minimalStart = useMinimalStart();
  const composerLayoutLabels: Record<ComposerLayout, string> = {
    classic: text.composerLayoutClassic,
    calm: text.composerLayoutCalm,
    capsule: text.composerLayoutCapsule,
  };
  const sidebarItems = useSidebarItems();
  const navLayout = useNavLayout();
  const navLayoutLabels: Record<NavLayout, string> = { classic: text.navLayoutClassic, rail: text.navLayoutRail };
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
        <SettingsBlock id="conversation-link-target" title={text.conversationLinkTarget} hint={text.conversationLinkHint} layout="inline">
          <Segmented label={text.conversationLinkTarget} value={conversationLinkTarget}
            options={conversationLinkOptions} onChange={setConversationLinkTarget} />
        </SettingsBlock>
        <SettingsBlock id="workbench-split" title={text.workbenchSplit} hint={text.workbenchSplitHint} layout="inline">
          <SettingsSwitch label={text.workbenchSplit} checked={preferences.workbenchSplit} onChange={preferences.setWorkbenchSplit} />
        </SettingsBlock>
      </SettingsGroup>
      <SettingsGroup title={copy.sections.navLayout}>
        <SettingsBlock id="nav-layout" title={text.navLayout} hint={text.navLayoutHint} layout="inline">
          <Segmented label={text.navLayout} value={navLayout}
            options={navLayouts.map(id => ({ id, label: navLayoutLabels[id] }))} onChange={setNavLayout} />
        </SettingsBlock>
        <SettingsBlock id="info-layout" title={text.infoLayout} hint={text.infoLayoutHint} layout="inline">
          <Segmented menu label={text.infoLayout} value={infoLayout} options={infoLayoutOptions} onChange={setInfoLayout} />
          {infoLayout === "cards" ? <p className="settings-hint">{text.infoLayoutCardsHint}</p> : null}
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
        <SettingsBlock id="minimal-start" title={text.minimalStart} hint={text.minimalStartHint} layout="inline">
          <SettingsSwitch label={text.minimalStart} checked={minimalStart} onChange={setMinimalStart} />
        </SettingsBlock>
      </SettingsGroup>
      <SettingsGroup title={copy.sections.composer}>
        <SettingsBlock id="composer-layout" title={text.composerLayout} hint={text.composerLayoutHint} layout="inline">
          <Segmented
            label={text.composerLayout}
            value={composerLayout}
            options={composerLayouts.map(id => ({ id, label: composerLayoutLabels[id] }))}
            onChange={setComposerLayout}
          />
        </SettingsBlock>
        <SettingsBlock id="composer-capsules" title={text.composerCapsules} hint={text.composerCapsulesHint} layout="inline">
          <SettingsSwitch label={text.composerCapsules} checked={composerCapsules} onChange={setComposerCapsules} />
        </SettingsBlock>
        <SettingsBlock id="send-button-icon" title={text.sendButtonIcon} layout="inline">
          <Segmented
            label={text.sendButtonIcon}
            value={sendButtonIcon}
            options={[
              { id: "paper-plane", label: text.sendButtonIconPaperPlane },
              { id: "arrow-up", label: text.sendButtonIconArrowUp },
            ]}
            onChange={setSendButtonIcon}
          />
        </SettingsBlock>
      </SettingsGroup>
    </section>
  );
}
