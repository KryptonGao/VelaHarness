import { tr } from "../locale";
import type { BrowserError } from "./browser-store";

export interface BrowserErrorView {
  title: string;
  hint: string;
  /** Chromium 的网络错误名（如 ERR_NAME_NOT_RESOLVED），给想排查的人看。 */
  technical: string | null;
}

/** 主进程给的是 `ERR_X`，loadURL 的拒绝原因是 `Error: ERR_X (-105) loading '…'`，两种都取出名字。 */
export function netErrorName(detail: string | undefined): string | null {
  return detail?.match(/ERR_[A-Z0-9_]+/)?.[0] ?? null;
}

export function isLocalBrowserUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(host) || host.endsWith(".localhost");
  } catch {
    return false;
  }
}

/** 把页面级错误翻译成人话：发生了什么、下一步怎么办。地址栏输入有误（invalid-address）不走这里。 */
export function describeBrowserError(error: BrowserError, pageUrl?: string): BrowserErrorView {
  if (error.code === "renderer-gone") {
    return {
      title: tr("页面已崩溃", "The page crashed"),
      hint: tr("页面进程意外退出，重新加载即可恢复。", "The page process exited unexpectedly. Reload to recover."),
      technical: null,
    };
  }
  const name = netErrorName(error.detail);
  const technical = name ?? (error.detail ? error.detail.slice(0, 160) : null);
  if (name === "ERR_NAME_NOT_RESOLVED" || name === "ERR_NAME_RESOLUTION_FAILED") return {
    title: tr("找不到服务器", "Can't find the server"),
    hint: tr("请检查网址拼写，或确认网络连接正常。", "Check the address for typos and make sure you're online."),
    technical,
  };
  if (name === "ERR_INTERNET_DISCONNECTED" || name === "ERR_NETWORK_CHANGED" || name === "ERR_NETWORK_ACCESS_DENIED") return {
    title: tr("没有网络连接", "You're offline"),
    hint: tr("连接网络后重试。", "Reconnect to the internet and try again."),
    technical,
  };
  if (name === "ERR_CONNECTION_REFUSED") return {
    title: tr("无法连接到服务器", "Can't connect to the server"),
    hint: isLocalBrowserUrl(error.url ?? pageUrl)
      ? tr("这个本地地址没有服务在监听，请先启动开发服务器后重试。", "Nothing is listening at this local address. Start your dev server and try again.")
      : tr("服务器拒绝了连接，可能没有运行或端口不对。", "The server refused the connection. It may be down or on a different port."),
    technical,
  };
  if (name === "ERR_CONNECTION_TIMED_OUT" || name === "ERR_TIMED_OUT") return {
    title: tr("连接超时", "The connection timed out"),
    hint: tr("服务器响应太慢或暂时不可用。", "The server took too long to respond or is temporarily unavailable."),
    technical,
  };
  if (name && /^ERR_(CONNECTION_(RESET|CLOSED|ABORTED)|EMPTY_RESPONSE|HTTP2_PROTOCOL_ERROR|QUIC_PROTOCOL_ERROR)$/.test(name)) return {
    title: tr("连接被中断", "The connection was interrupted"),
    hint: tr("页面加载到一半断开了，稍后重试。", "The connection dropped while loading. Try again in a moment."),
    technical,
  };
  if (name && /^ERR_(CERT_|SSL_|BAD_SSL_)/.test(name)) return {
    title: tr("连接不安全", "The connection isn't secure"),
    hint: tr("网站的安全证书无效或已过期，为保护你的信息已停止加载。", "The site's security certificate is invalid or expired, so loading was stopped to protect you."),
    technical,
  };
  if (name === "ERR_TOO_MANY_REDIRECTS") return {
    title: tr("重定向次数过多", "Too many redirects"),
    hint: tr("该网站不断跳转，可能是 Cookie 或网站配置的问题。", "The site keeps redirecting. Cookies or its configuration may be the cause."),
    technical,
  };
  if (name && /^ERR_(PROXY_|TUNNEL_)/.test(name)) return {
    title: tr("无法通过代理访问", "Proxy connection failed"),
    hint: tr("请检查系统代理设置。", "Check your system proxy settings."),
    technical,
  };
  if (name && /^ERR_(UNSAFE_PORT|INVALID_URL|UNKNOWN_URL_SCHEME|BLOCKED_BY_)/.test(name)) return {
    title: tr("此网址被阻止", "This address is blocked"),
    hint: tr("该端口或网址出于安全原因无法打开。", "This port or address can't be opened for security reasons."),
    technical,
  };
  return {
    title: tr("页面加载失败", "Failed to load page"),
    hint: tr("加载这个页面时出了问题，请重试。", "Something went wrong loading this page. Try again."),
    technical,
  };
}
