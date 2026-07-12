import { onScopeDispose, ref, type Ref } from 'vue';

export type ToastKind = 'info' | 'success' | 'error';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

export interface ToastController {
  toasts: Ref<Toast[]>;
  show: (message: string, kind?: ToastKind, duration?: number) => number;
  dismiss: (id: number) => void;
  info: (message: string) => number;
  success: (message: string) => number;
  error: (message: string) => number;
  /** Duration 0 means sticky — used for "uploading…" notices you close by hand. */
  loading: (message: string) => number;
}

let nextId = 1;

/** Element Plus's `ElMessage`, minus Element Plus. */
export function useToasts(): ToastController {
  const toasts = ref<Toast[]>([]);
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const dismiss = (id: number) => {
    toasts.value = toasts.value.filter((toast) => toast.id !== id);
  };

  const show = (message: string, kind: ToastKind = 'info', duration = 3000) => {
    const id = nextId++;
    toasts.value = [...toasts.value, { id, kind, message }];
    if (duration > 0) {
      const timer = setTimeout(() => {
        timers.delete(timer);
        dismiss(id);
      }, duration);
      timers.add(timer);
    }
    return id;
  };

  // The editor can unmount with toasts still counting down; drop the pending
  // timers so none of them fire dismiss() into a torn-down scope.
  onScopeDispose(() => {
    timers.forEach(clearTimeout);
    timers.clear();
  });

  return {
    toasts,
    show,
    dismiss,
    info: (message) => show(message, 'info'),
    success: (message) => show(message, 'success'),
    error: (message) => show(message, 'error'),
    loading: (message) => show(message, 'info', 0)
  };
}
