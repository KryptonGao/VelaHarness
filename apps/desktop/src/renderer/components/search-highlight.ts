/** Name of the CSS highlight that marks search matches in the chat. Styled in 04-sidebar-header.css. */
export const searchHighlightName = "search-hit";

const maxRanges = 200;

/**
 * Highlight where `keywords` occur in the text under `root` and return the first match that is
 * actually on screen. Text in collapsed or hidden blocks is skipped. Matching ignores case.
 */
export function highlightMatches(root: HTMLElement, keywords: readonly string[]): Range | null {
  const needles = keywords.map(keyword => keyword.toLowerCase()).filter(Boolean);
  if (!needles.length) return null;
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: node => node.parentElement?.closest("script, style, [hidden]") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  for (let node = walker.nextNode(); node && ranges.length < maxRanges; node = walker.nextNode()) {
    const text = (node as Text).data;
    const lower = text.toLowerCase();
    // Case folding that changes the length would put the ranges in the wrong place.
    if (lower.length !== text.length) continue;
    for (const needle of needles) {
      for (let at = lower.indexOf(needle); at >= 0 && ranges.length < maxRanges; at = lower.indexOf(needle, at + needle.length)) {
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + needle.length);
        ranges.push(range);
      }
    }
  }
  clearSearchHighlight();
  if (!ranges.length) return null;
  if (typeof Highlight !== "undefined" && CSS.highlights) CSS.highlights.set(searchHighlightName, new Highlight(...ranges));
  return ranges.find(range => range.getBoundingClientRect().height > 0) ?? null;
}

export function clearSearchHighlight(): void {
  window.clearTimeout(fadeTimer);
  if (typeof CSS !== "undefined" && CSS.highlights) CSS.highlights.delete(searchHighlightName);
}

let fadeTimer = 0;

/** Remove the highlight after `ms`. A later jump takes over the timer. */
export function fadeSearchHighlight(ms: number): void {
  window.clearTimeout(fadeTimer);
  fadeTimer = window.setTimeout(clearSearchHighlight, ms);
}
