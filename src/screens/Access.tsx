import { useState, type FormEvent, type ReactNode } from 'react';
import { ArrowLeft, House, KeyRound, ShieldCheck, TriangleExclamationPoint } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Profile, SessionInfo } from '@/types';
import { APP_NAME, DEMO_PIN } from '@/config';
import { backend } from '@/lib/backend';
import { DEMO_FAMILY_CODE } from '@/lib/backend/demo';
import { errorMessage } from '@/lib/errors';
import { fmtTime } from '@/lib/time';
import { qk, useProfiles } from '@/hooks/queries';
import { PinPad } from '@/components/PinPad';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/Field';
import { Spinner } from '@/components/ui/Spinner';

const LAST_PROFILE_KEY = 'salas:last-profile';

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="safe-top safe-bottom mx-auto flex min-h-dvh max-w-md flex-col px-5 py-8">
      <div className="mb-8 flex items-center gap-2 text-muted">
        <img src="/icons/icon.svg" alt="" className="size-8 rounded-xl" />
        <span className="font-semibold">{APP_NAME}</span>
        {backend.mode === 'demo' ? <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-600">Demo</span> : null}
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1) Código de la casa (una vez por dispositivo)
// ---------------------------------------------------------------------------
const JOIN_ERRORS: Record<string, string> = {
  invalid_code: 'Ese no es el código. Pídeselo a Papá o Mamá.',
  rate_limited: 'Demasiados intentos. Espera 10 minutos e intenta de nuevo.',
  anonymous_disabled:
    'Falta activar "Allow anonymous sign-ins" en Supabase → Authentication → Sign In / Providers (ver README).',
  no_session: 'No se pudo iniciar sesión. Recarga la página.',
};

export function JoinScreen() {
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const join = useMutation({
    mutationFn: () => backend.joinHousehold(code),
    onSuccess: async (res) => {
      if (res.ok) await qc.invalidateQueries({ queryKey: qk.session });
      else setError(JOIN_ERRORS[res.error] ?? 'No se pudo entrar.');
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (code.trim()) join.mutate();
  };

  return (
    <Shell>
      <div className="mb-6 flex size-16 items-center justify-center rounded-3xl bg-brand/10 text-brand">
        <House className="size-8" aria-hidden />
      </div>
      <h1 className="text-3xl font-extrabold tracking-tight">¡Bienvenido a casa!</h1>
      <p className="mt-2 text-muted">
        Escribe el <b className="text-ink">código de la casa</b>. Solo se pide una vez en este celular.
      </p>
      <form onSubmit={submit} className="mt-8 space-y-3">
        <TextInput
          autoFocus
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          placeholder="Código de la casa"
          aria-label="Código de la casa"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="h-13 text-lg"
        />
        {error ? (
          <p role="alert" className="flex items-start gap-2 text-sm text-danger">
            <TriangleExclamationPoint className="mt-0.5 size-4 shrink-0" aria-hidden />
            {error}
          </p>
        ) : null}
        <Button type="submit" size="lg" block loading={join.isPending} disabled={!code.trim()}>
          Entrar
        </Button>
      </form>
      {backend.mode === 'demo' ? (
        <p className="mt-4 rounded-2xl bg-surface-2 p-3 text-sm text-muted">
          Modo demo: el código es <b className="text-ink">{DEMO_FAMILY_CODE}</b>
        </p>
      ) : null}
      <p className="mt-auto flex items-center gap-2 pt-10 text-xs text-muted">
        <ShieldCheck className="size-4 shrink-0" aria-hidden />
        Solo los celulares con el código pueden ver las reservas de la casa.
      </p>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// 2) ¿Quién eres? + PIN
// ---------------------------------------------------------------------------
export function ProfilePicker({ onSignedIn }: { onSignedIn: (s: SessionInfo, pin: string) => void }) {
  const { active, isLoading, error, refetch } = useProfiles();
  const [selected, setSelected] = useState<Profile | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const lastId = safeGet(LAST_PROFILE_KEY);

  if (isLoading) {
    return (
      <Shell>
        <div className="flex flex-1 items-center justify-center">
          <Spinner className="size-7 text-brand" />
        </div>
      </Shell>
    );
  }
  if (error) {
    return (
      <Shell>
        <p className="text-danger">{errorMessage(error)}</p>
        <Button className="mt-4" onClick={() => void refetch()}>
          Reintentar
        </Button>
      </Shell>
    );
  }

  if (selected) {
    const onComplete = async (pin: string) => {
      setPinError(null);
      try {
        const res = await backend.signIn(selected.id, pin);
        if (res.ok) {
          safeSet(LAST_PROFILE_KEY, selected.id);
          onSignedIn(res.session, pin);
          return true;
        }
        if (res.error === 'invalid_pin') {
          setPinError(res.remaining > 0 ? `PIN incorrecto. Te quedan ${res.remaining} intento${res.remaining === 1 ? '' : 's'}.` : 'PIN incorrecto.');
        } else if (res.error === 'locked') {
          setPinError(`Demasiados intentos. Vuelve a intentar a las ${fmtTime(res.retryAt)}.`);
        } else {
          setPinError('Este perfil no está disponible.');
        }
        return false;
      } catch (e) {
        setPinError(errorMessage(e));
        return false;
      }
    };
    return (
      <Shell>
        <button type="button" onClick={() => setSelected(null)} className="-ml-2 mb-4 inline-flex items-center gap-1 self-start rounded-full px-2 py-1 text-sm text-muted">
          <ArrowLeft className="size-4" aria-hidden /> Cambiar perfil
        </button>
        <div className="flex flex-col items-center text-center">
          <Avatar emoji={selected.emoji} color={selected.color} name={selected.name} size="xl" ring />
          <h1 className="mt-4 text-2xl font-extrabold">Hola, {selected.name}</h1>
          <p className="mt-1 text-muted">Escribe tu PIN de 4 dígitos</p>
        </div>
        <div className="mt-8">
          <PinPad onComplete={onComplete} error={pinError} />
        </div>
        <p className="mt-auto pt-8 text-center text-xs text-muted">
          {backend.mode === 'demo' ? (
            <>
              Modo demo: el PIN de todos es <b className="text-ink">{DEMO_PIN}</b>
            </>
          ) : (
            '¿Olvidaste tu PIN? Papá o Mamá pueden restablecerlo en Ajustes → Familia.'
          )}
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="text-3xl font-extrabold tracking-tight">¿Quién eres?</h1>
      <p className="mt-2 text-muted">Elige tu perfil para reservar a tu nombre.</p>
      <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {active.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              setPinError(null);
              setSelected(p);
            }}
            className="flex flex-col items-center gap-2 rounded-3xl border border-line bg-surface p-4 shadow-sm transition active:scale-[0.97]"
            style={p.id === lastId ? { boxShadow: `0 0 0 2px ${p.color}` } : undefined}
          >
            <Avatar emoji={p.emoji} color={p.color} name={p.name} size="lg" />
            <span className="font-semibold">{p.name}</span>
            {p.role === 'admin' ? <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Admin</span> : null}
          </button>
        ))}
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// 3) Crear PIN personal (cuando el PIN es el inicial o lo reseteó un admin)
// ---------------------------------------------------------------------------
export function SetPinScreen({ me, knownPin, onDone }: { me: SessionInfo['profile']; knownPin: string | null; onDone: () => void }) {
  return (
    <Shell>
      <div className="flex flex-col items-center text-center">
        <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-brand/10 text-brand">
          <KeyRound className="size-7" aria-hidden />
        </div>
        <h1 className="text-2xl font-extrabold">Crea tu PIN personal</h1>
        <p className="mt-1 max-w-xs text-muted">
          {me?.name}, elige 4 números que solo tú sepas. Así nadie podrá cancelar tus reservas.
        </p>
      </div>
      <div className="mt-8">
        <ChangePinFlow knownCurrent={knownPin} onDone={onDone} />
      </div>
    </Shell>
  );
}

/** Pasos: (PIN actual) → PIN nuevo → confirmar. Se reutiliza en Ajustes. */
export function ChangePinFlow({ knownCurrent, onDone }: { knownCurrent: string | null; onDone: () => void }) {
  const qc = useQueryClient();
  const [current, setCurrent] = useState<string | null>(knownCurrent);
  const [first, setFirst] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const step = current === null ? 'current' : first === null ? 'new' : 'confirm';
  const prompt = { current: 'Escribe tu PIN actual', new: 'Escribe tu PIN nuevo', confirm: 'Repite tu PIN nuevo' }[step];

  const onComplete = async (pin: string) => {
    setError(null);
    if (step === 'current') {
      setCurrent(pin);
      return true;
    }
    if (step === 'new') {
      if (pin === current) {
        setError('Debe ser diferente al actual.');
        return false;
      }
      if (/^(\d)\1{3}$/.test(pin) || pin === '1234') {
        setError('Muy fácil de adivinar. Elige otro.');
        return false;
      }
      setFirst(pin);
      return true;
    }
    if (pin !== first) {
      setError('No coinciden. Escríbelo otra vez.');
      setFirst(null);
      return false;
    }
    try {
      await backend.changePin(current as string, pin);
      await qc.invalidateQueries({ queryKey: qk.session });
      onDone();
      return true;
    } catch (e) {
      const msg = errorMessage(e);
      setError(msg);
      setFirst(null);
      if (/actual/i.test(msg)) setCurrent(null);
      return false;
    }
  };

  return (
    <div>
      <p className="mb-4 text-center font-semibold">{prompt}</p>
      <PinPad key={step} onComplete={onComplete} error={error} />
    </div>
  );
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* almacenamiento bloqueado: no pasa nada */
  }
}

// ---------------------------------------------------------------------------
// Errores de arranque
// ---------------------------------------------------------------------------
export function StartupError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Shell>
      <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-danger-soft text-danger">
        <TriangleExclamationPoint className="size-7" aria-hidden />
      </div>
      <h1 className="text-2xl font-extrabold">No pudimos conectar</h1>
      <p className="mt-2 text-muted">{message}</p>
      <Button className="mt-6" onClick={onRetry}>
        Reintentar
      </Button>
    </Shell>
  );
}
