import { localizeCopy } from "@vela/shared";
import { useEffect, useRef, useState } from "react";
import type { PluginCatalog, PluginSnapshot } from "@vela/shared";
import type { AppLocale } from "../hooks/usePreferences";

const copy = {
  en: { title: "Integrations", hint: "Connect your workspace apps to Vela.", connect: "Connect", disconnect: "Disconnect", cancel: "Cancel", retry: "Try again", loading: "Loading integrations…", failed: "Unable to update integrations. Please try again.", pending: "Tools will become available in the current chat after its turn finishes.", states: { disconnected: "Not connected", connecting: "Connecting…", connected: "Connected", error: "Connection failed" } },
  zh: { title: "集成", hint: "将你的工作应用连接到 Vela。", connect: "连接", disconnect: "断开连接", cancel: "取消", retry: "重试", loading: "正在加载集成…", failed: "无法更新集成，请重试。", pending: "当前对话将在本轮结束后启用新工具。", states: { disconnected: "未连接", connecting: "正在连接…", connected: "已连接", error: "连接失败" } },
};

// Notion and Linear marks are from Simple Icons (CC0); the DeepWiki mark is its official logo from deepwiki.com.
// Paths use currentColor so they follow the theme; the DeepWiki mark is drawn on a 48x48 grid.
const brandViewBox: Record<string, string> = { deepwiki: "0 0 48 48" };
const brandIcons: Record<string, string> = {
  notion: "M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.139c-.093-.514.28-.887.747-.933zM1.936 1.035l13.31-.98c1.634-.14 2.055-.047 3.082.7l4.249 2.986c.7.513.934.653.934 1.213v16.378c0 1.026-.373 1.634-1.68 1.726l-15.458.934c-.98.047-1.448-.093-1.962-.747l-3.129-4.06c-.56-.747-.793-1.306-.793-1.96V2.667c0-.839.374-1.54 1.447-1.632z",
  deepwiki: "M18.5847 20.1289L18.5847 20.1321C19.2629 19.7407 20.0334 19.5339 20.8136 19.5339L20.8709 19.5339L20.9521 19.5355C21.0062 19.537 21.0587 19.5386 21.1129 19.5434L21.1527 19.5466C21.7959 19.5943 22.4072 19.7757 22.9772 20.0892C23.0345 20.121 23.0902 20.1528 23.1459 20.1862C23.1889 20.2133 23.2319 20.2403 23.2765 20.269L23.3179 20.296C23.6697 20.5331 23.9865 20.8211 24.2667 21.1584C24.3049 21.2045 24.3415 21.2507 24.3861 21.3095L24.4084 21.3382C24.4371 21.3764 24.4657 21.4161 24.4928 21.4559L24.5421 21.5275C24.5644 21.5609 24.5851 21.5943 24.6058 21.6278C24.6233 21.6564 24.6408 21.685 24.6584 21.7137L24.6886 21.7646C25.0802 22.4408 25.2872 23.2141 25.2872 23.9969L25.2856 23.9969C25.2856 24.7813 25.0787 25.553 24.687 26.2292L24.6186 26.3454C24.5899 26.3915 24.5612 26.4361 24.5326 26.4806L24.5103 26.5141C24.1473 27.0471 23.6856 27.4846 23.1268 27.8219C23.0711 27.8554 23.0154 27.8872 22.958 27.919C22.9135 27.9445 22.8673 27.9667 22.8211 27.9906L22.7766 28.0129C22.3945 28.199 21.9869 28.3295 21.5554 28.4027C21.4965 28.4122 21.4376 28.4202 21.3787 28.4282L21.3294 28.4345C21.2816 28.4393 21.2339 28.4441 21.1845 28.4488C21.1558 28.4504 21.1272 28.4536 21.0985 28.4552C21.0587 28.4584 21.0205 28.46 20.9807 28.46C20.9473 28.46 20.9139 28.4616 20.8804 28.4632L20.8199 28.4632L20.8167 28.4632C20.035 28.4632 19.2645 28.2563 18.5863 27.8649L14.4533 25.4814L6.18421 30.2611L6.18102 39.7998L14.4501 44.5715L22.7224 39.7982L22.7224 35.0265C22.7224 34.2421 22.9294 33.4704 23.321 32.7942L23.3895 32.678C23.4181 32.6319 23.4468 32.5873 23.4755 32.5428L23.4977 32.5093C23.8607 31.9763 24.3224 31.5388 24.8812 31.2015C24.937 31.168 24.9927 31.1362 25.05 31.1044C25.0946 31.0805 25.1392 31.0567 25.1869 31.0328L25.2315 31.0105C25.6136 30.8244 26.0212 30.6939 26.4526 30.6207C26.5115 30.6112 26.5704 30.6032 26.6293 30.5952L26.6787 30.5889C26.7264 30.5841 26.7742 30.5793 26.8251 30.5746L26.9095 30.5682C26.9493 30.565 26.9875 30.5634 27.0273 30.5634C27.0608 30.5634 27.0942 30.5618 27.1276 30.5602L27.1881 30.5602L27.1913 30.5602C27.973 30.5602 28.7436 30.7671 29.4218 31.1585L33.5563 33.542L41.8286 28.7687L41.8254 19.2268L33.5579 14.4535L29.4234 16.8433L29.4202 16.8369C28.7404 17.2283 27.9714 17.4304 27.1849 17.4352L27.1324 17.4352L27.0496 17.4336C26.9955 17.432 26.9429 17.4304 26.8888 17.4256L26.849 17.4225C26.2058 17.3747 25.5945 17.1933 25.0245 16.8799C24.9672 16.8481 24.9115 16.8163 24.8558 16.7828C24.8112 16.7558 24.7682 16.7271 24.7252 16.7001L24.6838 16.6731C24.332 16.436 24.0152 16.148 23.735 15.8107C23.6968 15.7645 23.6601 15.7184 23.6156 15.6595L23.5933 15.6309C23.5646 15.5927 23.536 15.5529 23.5089 15.5131L23.4595 15.4415C23.4373 15.4081 23.4166 15.3747 23.3959 15.3413C23.3783 15.3127 23.3592 15.284 23.3417 15.2538L23.3131 15.2045C22.9214 14.5282 22.7145 13.755 22.7145 12.9721L22.7129 12.9721L22.7129 8.202L14.4836 3.45095L14.4438 3.42867L6.17466 8.20836L6.17147 17.747L14.4406 22.5188L18.5767 20.1321L18.5847 20.1289Z",
  linear: "M2.886 4.18A11.982 11.982 0 0 1 11.99 0C18.624 0 24 5.376 24 12.009c0 3.64-1.62 6.903-4.18 9.105L2.887 4.18ZM1.817 5.626l16.556 16.556c-.524.33-1.075.62-1.65.866L.951 7.277c.247-.575.537-1.126.866-1.65ZM.322 9.163l14.515 14.515c-.71.172-1.443.282-2.195.322L0 11.358a12 12 0 0 1 .322-2.195Zm-.17 4.862 9.823 9.824a12.02 12.02 0 0 1-9.824-9.824Z",
};

function PluginIcon({ plugin }: { plugin: PluginSnapshot }) {
  const brand = brandIcons[plugin.icon];
  return <span className="integration-icon" aria-hidden="true">{brand ?
    <svg viewBox={brandViewBox[plugin.icon] ?? "0 0 24 24"} fill="currentColor"><path d={brand} /></svg> : plugin.name.slice(0, 1)}</span>;
}

export function IntegrationsSection({ locale, workspacePath, conversationId }: { locale: AppLocale; workspacePath: string | null; conversationId?: string | null }) {
  const text = localizeCopy(locale, copy.zh, copy.en);
  const [catalog, setCatalog] = useState<PluginCatalog | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const context = useRef(0);
  const request = useRef(0);
  const action = useRef(0);

  useEffect(() => {
    const api = window.vela;
    if (!api) { setError(true); return; }
    const revision = ++context.current;
    let cwd = workspacePath;
    setCatalog(null); setError(false); setBusy(null);
    const load = async () => {
      const sequence = ++request.current;
      try {
        cwd ??= (await api.getState()).session.cwd;
        const next = await api.getPlugins({ cwd, conversationId });
        if (revision === context.current && sequence === request.current) { setCatalog(next); setError(false); }
      } catch { if (revision === context.current && sequence === request.current) setError(true); }
    };
    const offMcp = api.onMcpStatus(event => { if (event.cwd === cwd) void load(); });
    const offPlugins = api.onPluginStatus(event => {
      if (revision !== context.current) return;
      setCatalog(current => current ? { ...current, plugins: current.plugins.map(plugin => plugin.id === event.id ? { ...plugin, status: event.status, error: event.error } : plugin) } : current);
      void load();
    });
    void load();
    return () => { context.current++; offMcp(); offPlugins(); };
  }, [workspacePath, conversationId, reload]);

  async function act(plugin: PluginSnapshot, disconnect: boolean) {
    const api = window.vela;
    if (!api || !catalog) return;
    const revision = context.current;
    const sequence = ++action.current;
    setBusy(plugin.id); setError(false);
    if (!disconnect) setCatalog({ ...catalog, plugins: catalog.plugins.map(item => item.id === plugin.id ? { ...item, status: "connecting", error: undefined } : item) });
    try {
      const next = await (disconnect ? api.disconnectPlugin : api.connectPlugin)({ cwd: catalog.cwd, conversationId, id: plugin.id });
      if (revision === context.current && sequence === action.current) { request.current++; setCatalog(next); }
    } catch { if (revision === context.current && sequence === action.current) setError(true); }
    finally { if (revision === context.current && sequence === action.current) setBusy(null); }
  }

  return <section className="settings-section integrations-section" aria-label={text.title}>
    <div className="settings-block" data-setting-id="integrations"><h2>{text.title}</h2><p className="settings-hint">{text.hint}</p></div>
    {error ? <div className="settings-block"><p role="alert">{text.failed}</p><button className="settings-secondary" onClick={() => setReload(value => value + 1)}>{text.retry}</button></div> : null}
    {!catalog && !error ? <p role="status" className="settings-hint">{text.loading}</p> : null}
    {catalog?.plugins.map(plugin => <article className="integration-card" key={plugin.id}>
      <PluginIcon plugin={plugin} />
      <div className="integration-content"><h3>{plugin.name}</h3><p className="settings-hint">{plugin.description}</p>
        <p className={`integration-status ${plugin.status}`} role="status" aria-atomic="true">{text.states[plugin.status]}</p>
      </div>
      <div className="integration-actions">
        {plugin.status === "connecting" ? <button type="button" className="settings-secondary" aria-label={`${text.cancel} ${plugin.name}`} onClick={() => void act(plugin, true)}>{text.cancel}</button> : <>
          <button type="button" className="settings-secondary" disabled={busy === plugin.id} aria-label={`${plugin.status === "connected" ? text.disconnect : text.connect} ${plugin.name}`} onClick={() => void act(plugin, plugin.status === "connected")}>{plugin.status === "connected" ? text.disconnect : text.connect}</button>
          {plugin.status === "error" ? <button type="button" className="settings-secondary" disabled={busy === plugin.id} onClick={() => void act(plugin, true)}>{text.disconnect}</button> : null}
        </>}
      </div>
    </article>)}
    {catalog?.pendingApply ? <p className="settings-hint" role="status">{text.pending}</p> : null}
  </section>;
}
