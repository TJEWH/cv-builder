import { getCurrentScope, onScopeDispose, readonly, shallowRef, watch } from 'vue';

export type ToastTone = 'info' | 'success' | 'warning' | 'error';
export interface ToastOptions {
  tone?: ToastTone;
  duration?: number;
  key?: string;
  action?: { label: string; run: () => unknown | Promise<unknown> };
}
export interface Toast extends ToastOptions {
  id: number;
  revision: number;
  message: string;
  tone: ToastTone;
  duration: number;
}
type Lifetime = { timer?: ReturnType<typeof setTimeout>; started: number; remaining: number; pauses: Set<string> };

const toasts = shallowRef<Toast[]>([]);
const lifetimes = new Map<number, Lifetime>();
let sequence = 0;

function dismiss(id: number) {
  clearTimeout(lifetimes.get(id)?.timer);
  lifetimes.delete(id);
  toasts.value = toasts.value.filter(toast => toast.id !== id);
}
function startTimer(id: number, lifetime: Lifetime) {
  if (!lifetime.remaining || lifetime.pauses.size) return;
  lifetime.started = Date.now();
  lifetime.timer = setTimeout(() => dismiss(id), lifetime.remaining);
  // Notifications must not keep a non-browser test process alive.
  if (typeof lifetime.timer === 'object') lifetime.timer.unref?.();
}
function notify(input: ToastOptions & { message: string }): number {
  const message = input.message.trim();
  if (!message) return 0;
  const tone = input.tone || 'info';
  const existing = toasts.value.find(toast => input.key ? toast.key === input.key : !toast.key && toast.message === message && toast.tone === tone);
  const id = existing?.id || ++sequence;
  const duration = input.duration ?? (tone === 'error' || tone === 'warning' ? 0 : 6000);
  const pauses = lifetimes.get(id)?.pauses || new Set<string>();
  clearTimeout(lifetimes.get(id)?.timer);
  const toast: Toast = { ...input, id, revision: (existing?.revision || 0) + 1, message, tone, duration };
  toasts.value = existing ? toasts.value.map(item => item.id === id ? toast : item) : [...toasts.value, toast];
  const lifetime = { remaining: duration, started: Date.now(), pauses };
  lifetimes.set(id, lifetime);
  startTimer(id, lifetime);
  return id;
}
function pause(id: number, reason = 'pointer') {
  const lifetime = lifetimes.get(id);
  if (!lifetime || lifetime.pauses.has(reason)) return;
  if (!lifetime.pauses.size && lifetime.timer) {
    clearTimeout(lifetime.timer);
    lifetime.timer = undefined;
    lifetime.remaining = Math.max(1, lifetime.remaining - (Date.now() - lifetime.started));
  }
  lifetime.pauses.add(reason);
}
function resume(id: number, reason = 'pointer') {
  const lifetime = lifetimes.get(id);
  if (!lifetime || !lifetime.pauses.delete(reason) || lifetime.pauses.size) return;
  startTimer(id, lifetime);
}
function clear() { for (const toast of toasts.value) dismiss(toast.id); }

export function useToasts() { return { toasts: readonly(toasts), notify, dismiss, pause, resume, clear }; }

/** Announce each operation result once, including repeated attempts with the same result. */
export function useToastWatch(source: () => string | null | undefined, options: ToastOptions | (() => ToastOptions) = {}) {
  const key = `notice-${++sequence}`;
  let id = 0;
  const stop = watch(source, message => {
    if (!message?.trim()) { if (id) dismiss(id); return; }
    const settings = typeof options === 'function' ? options() : options;
    id = notify({ ...settings, key: settings.key || key, message });
  }, { immediate: true, flush: 'sync' });
  if (getCurrentScope()) onScopeDispose(() => {
    stop();
    // A retry cannot safely call a component after its document/account has closed.
    if (toasts.value.find(toast => toast.id === id)?.action) dismiss(id);
  });
  return stop;
}
