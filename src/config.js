// Configuração lida de variáveis de ambiente (Vite expõe apenas as que começam com VITE_).
// A chave "anon" do Supabase é pública por definição: a segurança vem das políticas RLS do banco.
// Nunca coloque a service_role key no frontend.
const env = import.meta.env;

export const SUPABASE_URL = (env.VITE_SUPABASE_URL || '').trim();
export const SUPABASE_ANON_KEY = (env.VITE_SUPABASE_ANON_KEY || '').trim();

const forced = (env.VITE_DATA_MODE || '').trim().toLowerCase();
export const DATA_MODE = forced === 'local' || forced === 'supabase'
  ? forced
  : (SUPABASE_URL && SUPABASE_ANON_KEY ? 'supabase' : 'local');

export const LOCAL_ADMIN = {
  email: (env.VITE_LOCAL_ADMIN_EMAIL || 'moderacao@experience.demo').trim().toLowerCase(),
  password: env.VITE_LOCAL_ADMIN_PASSWORD || 'Moderacao@2026'
};

export const APP_VERSION = '2.0.0';
