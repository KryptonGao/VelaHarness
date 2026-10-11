/**
 * 沙盒微应用 iframe（IUI-14）的导航守卫：子框架只能停留在 about:srcdoc / about:blank。
 * 任何把 iframe 跳到网络、文件或其它协议的尝试都应被拦截。主框架的导航由窗口自己的规则处理。
 */
export function allowSubframeNavigation(url: string, isMainFrame: boolean): boolean {
  if (isMainFrame) return true;
  return url === "about:srcdoc" || url === "about:blank";
}
