/**
 * When the renderer first saw each tool call start. Rows unmount when the user switches sessions or
 * panes, so the start time cannot live in a row; the first report wins, repeats are ignored.
 */
const starts = new Map<string, number>();
const LIMIT = 500;

export function noteToolStart(id: string, now: number = Date.now()): void {
  if (starts.has(id)) return;
  starts.set(id, now);
  if (starts.size > LIMIT) {
    const oldest = starts.keys().next().value;
    if (oldest !== undefined) starts.delete(oldest);
  }
}

/** Start time of a call; a call never reported through noteToolStart starts counting now. */
export function toolStart(id: string, now: number = Date.now()): number {
  noteToolStart(id, now);
  return starts.get(id) ?? now;
}

export function forgetToolStart(id: string): void {
  starts.delete(id);
}
