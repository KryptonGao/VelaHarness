import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { extname, isAbsolute, join, relative, sep } from "node:path";

export const previewScheme = "vela-preview";
export const previewPrivileges = { standard: true, secure: true, corsEnabled: true, supportFetchAPI: true };
const maxBytes = 16 * 1024 * 1024;
const mime: Record<string, string> = {
  ".html": "text/html", ".htm": "text/html", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".ico": "image/x-icon", ".avif": "image/avif", ".bmp": "image/bmp",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".otf": "font/otf",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".mp4": "video/mp4", ".webm": "video/webm",
};

function safeSegments(parts: string[]): boolean {
  return parts.every(part => part && !part.startsWith(".") && !/[\\/:\0]/.test(part));
}

function workspacePath(root: string, file: string): string[] | null {
  const path = relative(root, file);
  const parts = path.split(sep);
  return !isAbsolute(path) && safeSegments(parts) ? parts : null;
}

/** Each registered folder has its own unguessable origin. Never serve arbitrary file: URLs. */
export class WorkspaceHtmlPreview {
  private readonly roots = new Map<string, string>(); // host → canonical workspace folder

  async documentUrl(file: string, roots: string[], size: number): Promise<string | undefined> {
    if (size > maxBytes || !/\.html?$/i.test(file)) return;
    const root = roots.find(candidate => workspacePath(candidate, file));
    if (!root) return;
    const [realRoot, realFile] = await Promise.all([realpath(root), realpath(file)]).catch(() => []);
    if (!realRoot || !realFile || !workspacePath(realRoot, realFile) || !/\.html?$/i.test(realFile)) return;
    let host = Array.from(this.roots).find(([, folder]) => folder === realRoot)?.[0];
    if (!host) { host = randomUUID(); this.roots.set(host, realRoot); }
    return `${previewScheme}://${host}/${workspacePath(root, file)!.map(encodeURIComponent).join("/")}`;
  }

  isDocumentUrl(raw: string): boolean {
    const url = URL.parse(raw);
    return !!url && url.protocol === `${previewScheme}:` && this.roots.has(url.host) && /\.html?$/i.test(url.pathname);
  }

  async serve(request: Request): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405 });
    try {
      const url = new URL(request.url);
      const root = this.roots.get(url.host);
      const parts = url.pathname.slice(1).split("/").map(decodeURIComponent);
      if (url.protocol !== `${previewScheme}:` || !root || !safeSegments(parts)) return new Response(null, { status: 404 });
      const type = mime[extname(parts.at(-1)!).toLowerCase()];
      if (!type) return new Response(null, { status: 404 });
      const file = await realpath(join(root, ...parts));
      if (!workspacePath(root, file) || type !== mime[extname(file).toLowerCase()]) return new Response(null, { status: 404 });
      const origin = `${previewScheme}://${url.host}`;
      const headers = {
        "Content-Type": type.startsWith("text/") ? `${type}; charset=utf-8` : type,
        "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
        // The sandboxed document has an opaque origin, including for module imports and fonts.
        "Access-Control-Allow-Origin": "null",
        "Content-Security-Policy": `sandbox allow-scripts; default-src 'none'; base-uri ${origin}; script-src ${origin} 'unsafe-inline'; style-src ${origin} 'unsafe-inline'; img-src ${origin} data: blob:; font-src ${origin} data:; media-src ${origin} blob:; connect-src ${origin}; form-action 'none'`,
      };
      const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const stat = await handle.stat();
        if (!stat.isFile()) return new Response(null, { status: 404 });
        if (stat.size > maxBytes) return new Response(null, { status: 413 });
        if (request.method === "HEAD") return new Response(null, { headers });
        // Bound the allocation even if a build is concurrently growing the asset.
        const data = new Uint8Array(stat.size);
        let offset = 0;
        while (offset < data.length) {
          const { bytesRead } = await handle.read(data, offset, data.length - offset, offset);
          if (!bytesRead) break;
          offset += bytesRead;
        }
        return new Response(data.subarray(0, offset), { headers });
      } finally { await handle.close(); }
    } catch { return new Response(null, { status: 404 }); }
  }
}
