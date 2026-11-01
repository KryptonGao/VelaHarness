import { useEffect, useState, useSyncExternalStore } from "react";
import { UI_BROWSER_BLANK_URL } from "../../../browser-policy";
import type { BrowserController } from "../../browser/browser-controller";
import { describeBrowserError } from "../../browser/browser-error";
import { browserFavorites, useBrowserFavorites, type BrowserFavorite } from "../../browser/favorites-store";
import { tr, trf } from "../../locale";
import { AlertIcon, AnnotateIcon, ArrowLeftIcon, ArrowRightIcon, CloseIcon, GlobeIcon, RefreshIcon, StarIcon } from "../icons";

/** 网站图标；没有地址或图片加载失败时退回地球图标。 */
export function SiteIcon({ src, size = 12, fallbackSize = size }: { src?: string; size?: number; fallbackSize?: number }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) return <GlobeIcon size={fallbackSize} />;
  return <img className="browser-site-icon" src={src} width={size} height={size} alt="" draggable={false}
    referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}

function favoriteLabel(favorite: BrowserFavorite): string {
  if (favorite.title) return favorite.title;
  try { return new URL(favorite.url).hostname.replace(/^www\./, ""); } catch { return favorite.url; }
}

/** Presentation and DOM binding only. Guest events/navigation live in BrowserController. */
export function BrowserPanel({ controller, tabId, operating, onAbort }: { controller: BrowserController; tabId: string; operating?: boolean; onAbort?: () => void }) {
  const state = useSyncExternalStore(controller.store.subscribe, controller.store.getSnapshot);
  const addressError = state.error?.code === "invalid-address"
    ? tr("请输入有效的 HTTP 或 HTTPS 网址", "Enter a valid HTTP or HTTPS address") : null;
  // 页面级错误（加载失败、崩溃）直接占据页面区域，而不是挤在工具栏下面的一行小字里。
  const pageError = state.error && !addressError ? describeBrowserError(state.error, state.url) : null;
  const failedUrl = state.error?.url || (state.url !== UI_BROWSER_BLANK_URL ? state.url : "");
  const blank = state.url === UI_BROWSER_BLANK_URL;
  const annotateDisabled = !state.ready || blank || !!state.error || !!operating;
  const annotateLabel = state.annotating ? tr("退出批注", "Exit annotation") : tr("批注", "Annotate");
  const favorites = useBrowserFavorites();
  const favorited = favorites.some(item => item.url === state.url);
  const favoriteLabelText = favorited ? tr("取消收藏", "Remove from favorites") : tr("收藏此页", "Add to favorites");
  // 已收藏的页面打开后顺手更新标题和图标，首页的快捷方式不会停留在旧样子。
  useEffect(() => {
    if (!state.loading && !state.error) browserFavorites.refresh(state.url, state.title, state.favicon || undefined);
  }, [state.url, state.title, state.favicon, state.loading, state.error]);
  const refreshLabel = state.loading ? tr("停止加载", "Stop loading") : tr("刷新", "Reload");

  return <section className="browser-panel" aria-label={tr("浏览器", "Browser")}>
    <div className="browser-toolbar">
      <button type="button" className="browser-nav" aria-label={tr("后退", "Back")}
        title={tr("后退", "Back")} disabled={!state.ready || !state.canGoBack} onClick={controller.back}>
        <ArrowLeftIcon size={14} />
      </button>
      <button type="button" className="browser-nav" aria-label={tr("前进", "Forward")}
        title={tr("前进", "Forward")} disabled={!state.ready || !state.canGoForward} onClick={controller.forward}>
        <ArrowRightIcon size={14} />
      </button>
      <button type="button" className="browser-nav" aria-label={refreshLabel} title={refreshLabel}
        disabled={!state.ready} onClick={state.loading ? controller.stop : controller.refresh}>
        {state.loading ? <CloseIcon size={14} /> : <RefreshIcon size={14} />}
      </button>
      <form className="browser-address-form" onSubmit={(event) => { event.preventDefault(); controller.navigate(); }}>
        <input className="browser-address" aria-label={tr("网页地址", "Web address")}
          placeholder={tr("输入网址", "Enter a URL")} value={state.address}
          autoComplete="off" spellCheck={false} aria-invalid={state.error?.code === "invalid-address" || undefined}
          onChange={(event) => controller.setAddress(event.target.value)}
          onFocus={(event) => { controller.beginAddressEdit(); event.currentTarget.select(); }}
          onBlur={controller.endAddressEdit}
          onKeyDown={(event) => {
            if (event.key === "Escape") { controller.resetAddress(); event.currentTarget.blur(); }
          }} />
      </form>
      <button type="button" className="browser-nav browser-favorite" aria-label={favoriteLabelText} title={favoriteLabelText}
        aria-pressed={favorited} disabled={blank || !!state.error}
        onClick={() => browserFavorites.toggle({ url: state.url, title: state.title, ...(state.favicon ? { favicon: state.favicon } : {}) })}>
        <StarIcon size={14} filled={favorited} />
      </button>
      {controller.supportsAnnotation && <button type="button" className="browser-nav browser-annotate" aria-label={annotateLabel}
        title={operating ? tr("Agent 正在操作浏览器", "The Agent is using the browser") : annotateLabel}
        aria-pressed={state.annotating} disabled={annotateDisabled && !state.annotating}
        onClick={() => controller.setAnnotating(!state.annotating)}>
        <AnnotateIcon size={14} />
      </button>}
    </div>
    <div className="browser-progress" data-active={state.loading || undefined} aria-hidden="true" />
    <div className="browser-page-info">
      <span className="browser-page-title" title={state.title || state.url}>
        {state.title || tr("浏览器", "Browser")}
      </span>
      <span className="browser-load-status" role="status">
        {state.loading ? tr("加载中…", "Loading…") : state.error ? tr("加载失败", "Load failed")
          : state.url === UI_BROWSER_BLANK_URL ? tr("手动浏览", "Manual browsing") : tr("已加载", "Loaded")}
      </span>
    </div>
    {operating && <div className="browser-operating" role="status">
      <span>{tr("Agent 正在操作此对话的浏览器", "Agent is using this conversation’s browser")}</span>
      <button type="button" onClick={onAbort}>{tr("停止", "Stop")}</button>
    </div>}
    {addressError && <div className="browser-notice" role="alert">{addressError}</div>}
    <div className="browser-viewport" data-browser-viewport={tabId}>
      {pageError && <div className="browser-error" role="alert">
        <span className="browser-error-icon" aria-hidden="true"><AlertIcon size={22} /></span>
        <h2>{pageError.title}</h2>
        <p>{pageError.hint}</p>
        {failedUrl && <code className="browser-error-url" title={failedUrl}>{failedUrl}</code>}
        {pageError.technical && <span className="browser-error-code">{pageError.technical}</span>}
        <button type="button" className="browser-error-retry" onClick={controller.retry}>
          <RefreshIcon size={13} />{tr("重试", "Try again")}
        </button>
      </div>}
      {state.url === UI_BROWSER_BLANK_URL && !state.loading && !state.error && <div className="browser-empty">
        <span aria-hidden="true"><GlobeIcon size={28} /></span>
        <h2>{tr("打开网页", "Open a web page")}</h2>
        <p>{tr("在地址栏输入网址，开始浏览", "Enter a URL in the address bar to start browsing")}</p>
        {favorites.length > 0 && <div className="browser-favorites" role="list" aria-label={tr("收藏", "Favorites")}>
          {favorites.map(favorite => <div className="browser-favorite-item" role="listitem" key={favorite.url}>
            <button type="button" className="browser-favorite-open" title={favorite.url} onClick={() => controller.visit(favorite.url)}>
              <span className="browser-favorite-icon" aria-hidden="true"><SiteIcon src={favorite.favicon} size={20} /></span>
              <span className="browser-favorite-name">{favoriteLabel(favorite)}</span>
            </button>
            <button type="button" className="browser-favorite-remove" aria-label={trf("移除收藏 {0}", "Remove favorite {0}", favoriteLabel(favorite))}
              title={tr("取消收藏", "Remove from favorites")} onClick={() => browserFavorites.remove(favorite.url)}>
              <CloseIcon size={10} />
            </button>
          </div>)}
        </div>}
      </div>}
    </div>
  </section>;
}

export function BrowserTabIcon({ controller }: { controller: BrowserController }) {
  const state = useSyncExternalStore(controller.store.subscribe, controller.store.getSnapshot);
  return <SiteIcon src={state.favicon} size={16} fallbackSize={12} />;
}

export function BrowserTabLabel({ controller }: { controller: BrowserController }) {
  const state = useSyncExternalStore(controller.store.subscribe, controller.store.getSnapshot);
  const label = state.title || (state.url !== UI_BROWSER_BLANK_URL ? state.url : tr("浏览器", "Browser"));
  return <span className="workbench-tab-label" title={label}>{label}</span>;
}
