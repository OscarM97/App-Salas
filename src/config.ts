const env = import.meta.env;

export const SUPABASE_URL: string = (env.VITE_SUPABASE_URL ?? '').trim();
export const SUPABASE_KEY: string = (env.VITE_SUPABASE_PUBLISHABLE_KEY ?? env.VITE_SUPABASE_ANON_KEY ?? '').trim();

/** Sin Supabase configurado (o con VITE_DEMO=true) la app corre en modo demo local. */
export const IS_DEMO: boolean = env.VITE_DEMO === 'true' || !SUPABASE_URL || !SUPABASE_KEY;

export const APP_NAME = 'Salas de la Casa';
export const DEMO_PIN = '1234';
