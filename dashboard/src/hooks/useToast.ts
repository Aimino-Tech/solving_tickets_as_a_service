import { useState, useCallback, useRef, useEffect } from 'react';

export type ToastVariant = 'success' | 'error';

export interface ToastData {
  id: number;
  title?: string;
  description?: string;
  variant: ToastVariant;
}

interface ToastOptions {
  title?: string;
  description?: string;
  variant: ToastVariant;
}

let nextId = 0;

interface UseToastReturn {
  toasts: readonly ToastData[];
  toast: (options: ToastOptions) => void;
  dismiss: (id: number) => void;
}

const AUTO_DISMISS_MS = 4000;

export function useToast(): UseToastReturn {
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (options: ToastOptions) => {
      const id = nextId++;
      const data: ToastData = { id, ...options };
      setToasts((prev) => [...prev, data]);

      const timer = setTimeout(() => {
        dismiss(id);
      }, AUTO_DISMISS_MS);
      timersRef.current.set(id, timer);
    },
    [dismiss],
  );

  // Cleanup all timers on unmount
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
    };
  }, []);

  return { toasts, toast, dismiss };
}
