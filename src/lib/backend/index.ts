import { IS_DEMO, SUPABASE_KEY, SUPABASE_URL } from '@/config';
import { DemoBackend } from './demo';
import { SupabaseBackend, assertConfigured } from './supabase';
import type { Backend } from './types';

export type { Backend } from './types';

function create(): { backend: Backend; configError: string | null } {
  if (IS_DEMO) return { backend: new DemoBackend(), configError: null };
  try {
    assertConfigured(SUPABASE_URL, SUPABASE_KEY);
    return { backend: new SupabaseBackend(SUPABASE_URL, SUPABASE_KEY), configError: null };
  } catch (e) {
    // Variables mal puestas en Vercel: mostramos el error en vez de una pantalla en blanco.
    return { backend: new DemoBackend({ broadcast: false }), configError: e instanceof Error ? e.message : String(e) };
  }
}

const created = create();
export const backend: Backend = created.backend;
/** Mensaje si VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY no son válidas. */
export const configError: string | null = created.configError;
