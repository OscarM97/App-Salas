import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { IconButton } from './Button';
import { cn } from './cn';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

/**
 * Hoja inferior (móvil) / diálogo centrado (desktop). El botón "atrás" de
 * Android la cierra en vez de salir de la app.
 */
export function Sheet({ open, onClose, title, children, footer, className }: SheetProps) {
  const id = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Historial: abrir = pushState; "atrás" = cerrar.
  useEffect(() => {
    if (!open) return;
    let pushed = true;
    window.history.pushState({ ...(window.history.state ?? {}), __sheet: id }, '');
    const onPop = (e: PopStateEvent) => {
      if ((e.state as { __sheet?: string } | null)?.__sheet === id) return;
      pushed = false;
      closeRef.current();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (pushed && (window.history.state as { __sheet?: string } | null)?.__sheet === id) window.history.back();
    };
  }, [open, id]);

  // Bloquear scroll del fondo, Escape para cerrar y foco inicial.
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const prevFocus = document.activeElement as HTMLElement | null;
    panelRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
      prevFocus?.focus?.({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div className="absolute inset-0 animate-fade-in bg-black/45 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        tabIndex={-1}
        className={cn(
          'relative flex max-h-[92dvh] w-full animate-sheet-in flex-col rounded-t-3xl bg-surface shadow-2xl outline-none sm:max-w-lg sm:rounded-3xl',
          className,
        )}
      >
        <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-line sm:hidden" aria-hidden />
        <div className="flex items-center justify-between gap-2 px-5 pb-2 pt-3">
          <h2 id={`${id}-title`} className="text-lg font-bold">
            {title}
          </h2>
          <IconButton label="Cerrar" onClick={onClose} className="-mr-2">
            <X className="size-5" />
          </IconButton>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-5">{children}</div>
        {footer ? <div className="safe-bottom border-t border-line bg-surface px-5 py-3 sm:rounded-b-3xl">{footer}</div> : null}
      </div>
    </div>
  );
}
