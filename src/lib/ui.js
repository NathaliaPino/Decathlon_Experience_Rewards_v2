export function escape(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const paths = {
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>', search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>', tag: '<path d="M20 13 11 22 2 13V3h10l8 8a1.4 1.4 0 0 1 0 2Z"/><circle cx="7" cy="8" r="1"/>', club: '<ellipse cx="12" cy="12" rx="10" ry="5" transform="rotate(-35 12 12)"/><path d="m9 17 6-10"/>', bag: '<path d="M4 7h16l-1 14H5L4 7Z"/><path d="M8 7V5a4 4 0 0 1 8 0v2M8 11c0 5 8 5 8 0"/>', arrow: '<path d="m9 5 7 7-7 7"/>', back: '<path d="m15 5-7 7 7 7"/>', heart: '<path d="M20.8 4.8a5.5 5.5 0 0 0-7.8 0L12 5.9l-1.1-1.1a5.5 5.5 0 1 0-7.8 7.8L12 21l8.8-8.4a5.5 5.5 0 0 0 0-7.8Z"/>', user: '<circle cx="12" cy="7" r="4"/><path d="M4 22v-3a8 8 0 0 1 16 0v3"/>', check: '<path d="m5 12 4 4L19 6"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/>', photo: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 5 5 3-3 4 4"/>', video: '<rect x="3" y="5" width="13" height="14" rx="3"/><path d="m16 9 5-3v12l-5-3Z"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>', plus: '<path d="M12 4v16M4 12h16"/>', shield: '<path d="M12 3 3 6v7c0 5 9 9 9 9s9-4 9-9V6Z"/><path d="m8 12 3 3 5-6"/>', sparkles: '<path d="m12 3 3 6 6 3-6 3-3 6-3-6-6-3 6-3Z"/>', truck: '<path d="M2 5h12v13H2ZM14 10h5l3 4v4h-8"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="19" r="2"/>', filter: '<path d="M4 6h16M7 12h10M10 18h4"/>', star: '<path d="m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z"/>', download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>', info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>', share: '<path d="m21 3-7 18-4-7-7-4 18-7ZM10 14l11-11"/>', logout: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3"/>', upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 16v4h16v-4"/>', flag: '<path d="M5 21V4h11l-1.5 4L16 12H5"/>'
};

export function icon(name, cls = '') {
  return `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.info}</svg>`;
}

export function date(v) {
  return new Date(v).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}
export function dateTime(v) {
  return new Date(v).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function initials(name) {
  return String(name || 'Você').trim().slice(0, 2).toUpperCase();
}
const AVATAR_COLORS = ['#dbe5dc', '#e8e0d6', '#e3dff0', '#dfe8f2', '#f2e3e3', '#e6eedd'];
export function avatarColor(seed = '') {
  let h = 0; for (const c of String(seed)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

let toastTimer;
export function toast(text) {
  const t = document.querySelector('#toast'); if (!t) return;
  t.textContent = text; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3800);
}

export function formatBytes(n) {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.ceil(n / 1024)} KB`;
}

export const STATUS_LABEL = { pending: 'Aguardando análise', approved: 'Aprovada', rejected: 'Não aprovada' };

// Traduz erros técnicos em mensagens claras para a pessoa usuária.
export function friendlyError(err) {
  const m = String(err?.message || err || '');
  if (/invalid login credentials|invalid-credentials/i.test(m)) return 'E-mail ou senha incorretos.';
  if (/email not confirmed/i.test(m)) return 'Confirme seu e-mail pelo link que enviamos antes de entrar.';
  if (/already registered|already exists|email-in-use/i.test(m)) return 'Já existe uma conta com este e-mail. Tente entrar.';
  if (/password should be at least|weak-password/i.test(m)) return 'A senha precisa ter pelo menos 8 caracteres.';
  if (/rate limit|too many/i.test(m)) return 'Muitas tentativas seguidas. Aguarde alguns minutos e tente novamente.';
  if (/failed to fetch|network/i.test(m)) return 'Sem conexão com o servidor. Verifique sua internet e tente novamente.';
  if (/not_authorized|42501|permission/i.test(m)) return 'Você não tem permissão para esta ação.';
  if (/review_not_pending/i.test(m)) return 'Esta avaliação já foi moderada.';
  if (/payload too large|exceeded the maximum/i.test(m)) return 'O arquivo é maior do que o permitido.';
  return 'Algo deu errado. Tente novamente em instantes.';
}
