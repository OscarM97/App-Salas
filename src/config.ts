const env = import.meta.env;

// También acepta los nombres que muestra el botón "Connect" de Supabase (NEXT_PUBLIC_…),
// para poder pegar ese .env.local tal cual en Vercel.
const pick = (...values: Array<string | undefined>) => (values.find((v) => v && v.trim()) ?? '').trim();

export const SUPABASE_URL: string = pick(env.VITE_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_URL);
export const SUPABASE_KEY: string = pick(
  env.VITE_SUPABASE_ANON_KEY,
  env.VITE_SUPABASE_PUBLISHABLE_KEY,
  env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY,
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY,
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

/** Sin Supabase configurado (o con VITE_DEMO=true) la app corre en modo demo local. */
export const IS_DEMO: boolean = env.VITE_DEMO === 'true' || !SUPABASE_URL || !SUPABASE_KEY;

/** Build para incrustar la demo en otra página (sin service worker ni "instalar app"). */
export const IS_EMBED: boolean = env.VITE_EMBED === 'true';

export const APP_NAME = 'Salas de la Casa';
export const DEMO_PIN = '1234';
