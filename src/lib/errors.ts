export type AppErrorCode =
  | 'room_conflict'
  | 'forbidden'
  | 'no_profile'
  | 'not_found'
  | 'in_past'
  | 'in_progress'
  | 'not_started'
  | 'already_cancelled'
  | 'invalid_range'
  | 'invalid_input'
  | 'invalid_pin'
  | 'invalid_pin_format'
  | 'last_admin'
  | 'has_reservations'
  | 'room_inactive'
  | 'too_far'
  | 'network'
  | 'config'
  | 'unknown';

export interface ConflictDetail {
  reservation_id?: string;
  profile_id?: string;
  owner_name?: string;
  starts_at?: string;
  ends_at?: string;
  purpose?: string | null;
}

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly detail?: ConflictDetail;

  constructor(code: AppErrorCode, message: string, detail?: ConflictDetail) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.detail = detail;
  }
}

const KNOWN = new Set<string>([
  'room_conflict', 'forbidden', 'no_profile', 'not_found', 'in_past', 'in_progress', 'not_started',
  'already_cancelled', 'invalid_range', 'invalid_input', 'invalid_pin', 'invalid_pin_format',
  'last_admin', 'has_reservations', 'room_inactive', 'too_far',
]);

interface PgLikeError {
  message?: string;
  hint?: string | null;
  details?: string | null;
  code?: string;
}

/** Convierte errores de Supabase/PostgREST/red en un AppError con texto para la familia. */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  const e = (err ?? {}) as PgLikeError;
  const hint = e.hint ?? '';
  if (KNOWN.has(hint)) {
    let detail: ConflictDetail | undefined;
    if (e.details) {
      try {
        detail = JSON.parse(e.details) as ConflictDetail;
      } catch {
        detail = undefined;
      }
    }
    return new AppError(hint as AppErrorCode, e.message ?? 'Algo salió mal.', detail);
  }
  if (e.code === '23P01') {
    return new AppError('room_conflict', 'Alguien acaba de reservar ese horario. Intenta de nuevo.');
  }
  const msg = String(e.message ?? err ?? '');
  if (/fetch|network|Failed to fetch|NetworkError|Load failed/i.test(msg)) {
    return new AppError('network', 'Sin conexión. Revisa tu internet e intenta de nuevo.');
  }
  return new AppError('unknown', msg || 'Algo salió mal. Intenta de nuevo.');
}

export function errorMessage(err: unknown): string {
  return toAppError(err).message;
}
