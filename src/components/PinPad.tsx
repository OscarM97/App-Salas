import { useCallback, useEffect, useRef, useState } from 'react';
import { Delete } from 'lucide-react';
import { Spinner } from './ui/Spinner';
import { cn } from './ui/cn';

interface PinPadProps {
  /** Devuelve true si el PIN fue aceptado; false para sacudir y limpiar. */
  onComplete: (pin: string) => Promise<boolean>;
  error?: string | null;
  disabled?: boolean;
  length?: number;
}

export function PinPad({ onComplete, error, disabled, length = 4 }: PinPadProps) {
  const [pin, setPinState] = useState('');
  const pinRef = useRef('');
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);

  const setPin = (v: string) => {
    pinRef.current = v;
    setPinState(v);
  };
  const [shake, setShake] = useState(0);

  const submit = useCallback(
    async (value: string) => {
      busyRef.current = true;
      setBusy(true);
      try {
        const ok = await onComplete(value);
        if (!ok) {
          setShake((s) => s + 1);
          setPin('');
        }
      } catch {
        setShake((s) => s + 1);
        setPin('');
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [onComplete],
  );

  const press = useCallback(
    (d: string) => {
      if (busyRef.current || disabled) return;
      const p = pinRef.current;
      if (p.length >= length) return;
      const next = p + d;
      setPin(next);
      if (next.length === length) void submit(next);
    },
    [disabled, length, submit],
  );

  const back = useCallback(() => {
    if (!busyRef.current) setPin(pinRef.current.slice(0, -1));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [press, back]);

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'back'];

  return (
    <div className="flex flex-col items-center">
      <div key={shake} className={cn('flex h-10 items-center gap-4', shake > 0 && 'animate-shake')} aria-label={`${pin.length} de ${length} dígitos`} role="status">
        {busy ? (
          <Spinner className="size-6 text-brand" />
        ) : (
          Array.from({ length }, (_, i) => (
            <span
              key={i}
              className={cn('size-4 rounded-full border-2 transition', i < pin.length ? 'scale-110 border-brand bg-brand' : 'border-line')}
            />
          ))
        )}
      </div>
      <p className={cn('mt-2 min-h-5 text-center text-sm', error ? 'text-danger' : 'text-transparent')} role={error ? 'alert' : undefined}>
        {error || '·'}
      </p>
      <div className="mt-3 grid w-full max-w-[18rem] grid-cols-3 gap-3">
        {keys.map((k, i) =>
          k === '' ? (
            <span key={i} />
          ) : k === 'back' ? (
            <button
              key={i}
              type="button"
              aria-label="Borrar"
              onClick={back}
              className="flex h-16 items-center justify-center rounded-2xl text-muted transition active:scale-95 active:bg-surface-2"
            >
              <Delete className="size-6" />
            </button>
          ) : (
            <button
              key={i}
              type="button"
              onClick={() => press(k)}
              disabled={disabled}
              className="h-16 rounded-2xl bg-surface text-2xl font-semibold shadow-sm ring-1 ring-line transition active:scale-95 active:bg-surface-2 disabled:opacity-40"
            >
              {k}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
