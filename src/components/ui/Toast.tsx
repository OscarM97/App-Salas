import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { CircleCheck, CircleExclamationPoint, Info, X } from 'lucide-react';
import { cn } from './cn';

type Tone = 'success' | 'error' | 'info';

export interface ToastOptions {
  title: string;
  description?: string;
  tone?: Tone;
  icon?: ReactNode;
  durationMs?: number;
}

interface ToastItem extends ToastOptions {
  id: number;
}

const ToastContext = createContext<(t: ToastOptions) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

const toneStyles: Record<Tone, string> = {
  success: 'text-free',
  error: 'text-danger',
  info: 'text-brand',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);

  const toast = useCallback(
    (t: ToastOptions) => {
      const id = nextId.current++;
      setItems((xs) => [...xs.slice(-2), { ...t, id }]);
      window.setTimeout(() => dismiss(id), t.durationMs ?? (t.tone === 'error' ? 6000 : 4500));
    },
    [dismiss],
  );

  const value = useMemo(() => toast, [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 px-3 pt-[calc(env(safe-area-inset-top)+0.75rem)]"
      >
        {items.map((t) => {
          const tone = t.tone ?? 'info';
          const Icon = tone === 'success' ? CircleCheck : tone === 'error' ? CircleExclamationPoint : Info;
          return (
            <div
              key={t.id}
              role={tone === 'error' ? 'alert' : 'status'}
              className="pointer-events-auto flex w-full max-w-md animate-toast-in items-start gap-3 rounded-2xl border border-line bg-surface p-3 pr-2 shadow-lg"
            >
              <span className={cn('mt-0.5 shrink-0', toneStyles[tone])}>{t.icon ?? <Icon className="size-5" />}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{t.title}</p>
                {t.description ? <p className="mt-0.5 text-sm text-muted">{t.description}</p> : null}
              </div>
              <button
                type="button"
                aria-label="Cerrar aviso"
                onClick={() => dismiss(t.id)}
                className="rounded-full p-1 text-muted hover:bg-surface-2"
              >
                <X className="size-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
