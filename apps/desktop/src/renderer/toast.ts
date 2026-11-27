import type { IconName } from "./components/icons";
import { localizeError } from "./locale";

interface ToastAction {
  label: string;
  run: () => void;
  primary?: boolean;
}
interface ToastOptions {
  kind?: "info" | "error";
  icon?: IconName;
  actions?: readonly ToastAction[];
}
export interface Toast extends ToastOptions { id: number; message: string; closing?: boolean }

let nextId = 0;
let queue: readonly Toast[] = [];
const listeners = new Set<() => void>();
function publish(next: readonly Toast[]) {
  queue = next;
  for (const listener of listeners) listener();
}

/** Window-local, one-shot action feedback. Publish from the action, never from rendering a saved error. */
export function showToast(message: string, options: ToastOptions = {}): void {
  if (!message.trim()) return;
  const text = options.kind === "error" ? localizeError(message) : message;
  publish([...queue, { ...options, id: ++nextId, message: text }]);
}
export function dismissToast(id: number): boolean {
  const toast = queue.find(item => item.id === id);
  if (!toast || toast.closing) return false;
  publish(queue.map(item => item === toast ? { ...item, closing: true } : item));
  return true;
}
export function finishToastExit(id: number): void {
  publish(queue.filter(item => item.id !== id));
}
export function subscribeToasts(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export const getToasts = () => queue;
