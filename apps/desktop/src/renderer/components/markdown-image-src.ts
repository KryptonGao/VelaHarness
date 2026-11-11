export type ChatImageSource =
  | { kind: "remote"; src: string }
  | { kind: "file"; path: string }
  | { kind: "none" };

const none: ChatImageSource = { kind: "none" };

/**
 * 把正式回复里 `![](...)` 的地址分成网络图片和本地文件。
 * 本地文件交给主进程按工作区规则读取,所以这里只识别形状,不判断文件是否存在。
 * 其他协议(javascript:、blob: 等)一律拒绝。
 */
export function classifyChatImageSrc(raw: string): ChatImageSource {
  const value = raw.trim();
  if (!value || value.includes("\0")) return none;

  // 盘符路径(C:/x.png)带冒号,要先于协议判断。
  if (/^[a-zA-Z]:[\\/]/.test(value)) return filePath(value);

  const protocol = /^([a-z][a-z0-9+.-]*):/i.exec(value);
  if (!protocol) return filePath(value);

  const scheme = protocol[1]?.toLowerCase() ?? "";
  if (scheme === "http" || scheme === "https") return { kind: "remote", src: value };
  if (scheme === "data") return /^data:image\/[a-z0-9.+-]+[;,]/i.test(value) ? { kind: "remote", src: value } : none;
  if (scheme === "file") return fileUrlPath(value);
  return none;
}

function fileUrlPath(value: string): ChatImageSource {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return none;
  }
  if (url.host && url.host !== "localhost") return none;
  const path = decodeSafe(url.pathname);
  // file:///C:/x.png 的路径是 /C:/x.png。
  return filePath(/^\/[a-zA-Z]:\//.test(path) ? path.slice(1) : path);
}

function filePath(value: string): ChatImageSource {
  const hash = value.indexOf("#");
  const withoutHash = hash >= 0 ? value.slice(0, hash) : value;
  const query = withoutHash.indexOf("?");
  const path = decodeSafe(query >= 0 ? withoutHash.slice(0, query) : withoutHash).replaceAll("\\", "/").trim();
  if (!path || path.includes("\0") || path.length > 1024) return none;
  return { kind: "file", path };
}

function decodeSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** react-markdown 的 urlTransform:链接保持原来的白名单,只有图片地址额外放行本地文件。 */
export function replyUrlTransform(url: string, key: string, safeLink: (url: string) => string): string {
  if (key !== "src") return safeLink(url);
  return classifyChatImageSrc(url).kind === "none" ? "" : url;
}
