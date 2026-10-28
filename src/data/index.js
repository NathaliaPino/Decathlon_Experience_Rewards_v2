// Ponto único de acesso aos dados. O app nunca fala direto com Supabase ou localStorage.
import { DATA_MODE } from '../config.js';

let api;
if (DATA_MODE === 'supabase') {
  ({ supabaseAdapter: api } = await import('./supabase.js'));
} else {
  ({ localAdapter: api } = await import('./local.js'));
}

export const db = api;

export function balanceOf(ledger) {
  return ledger.reduce((sum, l) => sum + l.points, 0);
}
