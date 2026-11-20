export interface WebResultPage { href: string; title: string; host: string }

/** Read the result metadata, never links embedded in snippets or fetched articles. */
export function webResultPages(fetch: boolean, body: string, command?: string): WebResultPage[] {
  const pages = new Map<string, WebResultPage>();
  function add(raw: string, title?: string) {
    try {
      const url = new URL(raw);
      if (!/^https?:$/.test(url.protocol) || url.username || url.password || pages.has(url.href)) return;
      const host = url.hostname.replace(/^www\./, "");
      pages.set(url.href, { href: url.href, title: title?.trim() || host, host });
    } catch { /* Older transcripts can contain incomplete URLs. */ }
  }
  if (fetch) {
    const header = /^Fetched (\S+) via [^\n]+\n(?:Title: ([^\n]+))?/.exec(body);
    const href = header?.[1] || command;
    if (href) add(href, header?.[2]);
  } else {
    const results = body.split("\n<untrusted_web_content>\n")[1];
    if (results) for (const hit of results.matchAll(/^\d+\. ([^\n]*)\n   URL: (\S+)[ \t]*$/gm)) add(hit[2], hit[1]);
  }
  return [...pages.values()];
}
