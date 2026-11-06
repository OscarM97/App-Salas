import { useState } from 'react';
import { Download, Share, Smartphone, X } from 'lucide-react';
import { IS_EMBED } from '@/config';
import { useInstallPrompt } from '@/hooks/useInstallPrompt';
import { Button } from './ui/Button';

const DISMISS_KEY = 'salas:install-dismissed';

/** Invita a instalar la app en la pantalla de inicio (Android: botón; iPhone: instrucciones). */
export function InstallCard({ force = false }: { force?: boolean }) {
  const { installed, canPrompt, platform, install } = useInstallPrompt();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });

  if (IS_EMBED) return null;
  if (installed) return force ? <p className="text-sm text-free">✓ La app ya está instalada en este dispositivo.</p> : null;
  if (!force && (dismissed || (!canPrompt && platform !== 'ios'))) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* ignorar */
    }
  };

  return (
    <div className="relative mt-4 rounded-3xl border border-brand/25 bg-brand/5 p-4">
      {!force ? (
        <button type="button" aria-label="No mostrar" onClick={dismiss} className="absolute right-2 top-2 rounded-full p-1.5 text-muted hover:bg-surface-2">
          <X className="size-4" />
        </button>
      ) : null}
      <div className="flex gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand text-brand-ink">
          <Smartphone className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 pr-6">
          <p className="font-semibold">Ponla como app en tu celular</p>
          {canPrompt ? (
            <>
              <p className="text-sm text-muted">Ábrela con un toque, a pantalla completa, como cualquier otra app.</p>
              <Button size="sm" className="mt-2" icon={<Download className="size-4" />} onClick={() => void install()}>
                Instalar app
              </Button>
            </>
          ) : platform === 'ios' ? (
            <p className="text-sm text-muted">
              En Safari toca <Share className="inline size-4 align-[-3px]" aria-label="Compartir" /> <b>Compartir</b> y luego{' '}
              <b>“Agregar a inicio”</b>.
            </p>
          ) : (
            <p className="text-sm text-muted">
              En Chrome abre el menú <b>⋮</b> y elige <b>“Instalar app”</b> o <b>“Agregar a pantalla principal”</b>.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
