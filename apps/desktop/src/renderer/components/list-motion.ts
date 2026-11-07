export interface MotionEntry<T> {
  key: string;
  item: T;
  present: boolean;
  entering: boolean;
}

/**
 * Retain removed items at their former index while live items follow the new order.
 * Keys in `instant` are moving to another list: they leave and arrive without an exit/enter animation,
 * so the same row is never visible in both lists at once.
 */
export function reconcileMotionItems<T>(previous: MotionEntry<T>[], items: readonly T[], keyOf: (item: T) => string, instant?: ReadonlySet<string>): MotionEntry<T>[] {
  const old = new Map(previous.map((entry) => [entry.key, entry]));
  const next = items.map((item) => {
    const key = keyOf(item);
    return { key, item, present: true, entering: old.get(key)?.entering ?? !instant?.has(key) };
  });
  const live = new Set(next.map((entry) => entry.key));
  previous.forEach((entry, index) => {
    if (!live.has(entry.key) && !instant?.has(entry.key)) next.splice(Math.min(index, next.length), 0, { ...entry, present: false });
  });
  return next;
}
