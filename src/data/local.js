// Banco local simulado: mesma API do adaptador Supabase, persistida no navegador.
// - Dados estruturados: localStorage (chave der-db-v2)
// - Arquivos de mídia: IndexedDB (der-media)
// Útil para demonstração offline e desenvolvimento. Não sincroniza entre dispositivos.
import { LOCAL_ADMIN } from '../config.js';
import { POINTS_PER_REVIEW, benefitById } from '../lib/catalog.js';
import { uuid } from '../lib/ui.js';

const DB_KEY = 'der-db-v2';
// O painel admin usa uma sessão separada para permitir app e moderação em abas diferentes.
const SESSION_KEY = location.pathname.endsWith('admin.html') ? 'der-admin-session-v2' : 'der-session-v2';
const listeners = new Set();
const authListeners = new Set();

const SEED_REVIEWS = [
  { id: 'demo-marina', authorName: 'Marina', sport: 'Trilha', level: 'Intermediário', frequency: '2–3 vezes por semana', rating: 5, text: 'Uso em trilhas curtas na serra, geralmente no começo da manhã. Aquece bem sem pesar na mochila. O corte é mais justo: para usar por cima de outra blusa, eu escolheria um tamanho maior.', context: 'Trilhas de 8 a 12 km · manhãs frescas', createdAt: '2026-10-08T10:00:00Z' },
  { id: 'demo-caio', authorName: 'Caio', sport: 'Trilha', level: 'Iniciante', frequency: '1 vez por semana', rating: 4, text: 'Foi minha primeira blusa para trilha. É macia e ajuda no frio leve. Em lugares com muito vento, senti falta de uma camada por cima. Gostei do zíper para controlar o calor na subida.', context: 'Passeios de 4 a 6 km · frio leve', createdAt: '2026-10-07T10:00:00Z' },
  { id: 'demo-luiza', authorName: 'Luiza', sport: 'Corrida', level: 'Avançado', frequency: '4 ou mais vezes por semana', rating: 5, text: 'Uso antes e depois dos treinos, em dias frios. O tecido é confortável e seca rápido. Para correr com intensidade, prefiro uma peça mais leve, mas ela funciona bem no aquecimento.', context: 'Antes e depois do treino · uso urbano', createdAt: '2026-10-06T10:00:00Z' }
].map(r => ({ ...r, userId: null, productId: 'fleece', mediaType: null, mediaPath: null, status: 'approved', moderationNote: null, moderatedAt: r.createdAt, isDemo: true }));

// ---------- persistência ----------
let memoryDb = null;
function load() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) { const db = JSON.parse(raw); if (db?.version === 2) return db; }
  } catch { /* armazenamento indisponível: usa memória */ }
  return memoryDb || (memoryDb = { version: 2, users: [], reviews: structuredClone(SEED_REVIEWS), ledger: [], redemptions: [] });
}
function persist(db) {
  memoryDb = db;
  try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch { /* segue em memória */ }
  emit();
}
function mutate(fn) { const db = load(); const out = fn(db); persist(db); return out; }
function emit() { listeners.forEach(cb => { try { cb(); } catch (e) { console.error(e); } }); }

window.addEventListener('storage', ev => {
  if (ev.key === DB_KEY) { memoryDb = null; emit(); }
  if (ev.key === SESSION_KEY) authListeners.forEach(cb => cb('SIGNED_' + (ev.newValue ? 'IN' : 'OUT')));
});

// ---------- senha (PBKDF2) ----------
async function hashPassword(password, salt) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations: 120000, hash: 'SHA-256' }, key, 256);
  return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function ensureAdmin() {
  const db = load();
  if (db.users.some(u => u.email === LOCAL_ADMIN.email)) return;
  const salt = uuid();
  const passwordHash = await hashPassword(LOCAL_ADMIN.password, salt);
  mutate(d => { if (!d.users.some(u => u.email === LOCAL_ADMIN.email)) d.users.push({ id: uuid(), email: LOCAL_ADMIN.email, firstName: 'Moderação', role: 'admin', salt, passwordHash, createdAt: new Date().toISOString() }); });
}
const ready = ensureAdmin();

function sessionUserId() { try { return localStorage.getItem(SESSION_KEY); } catch { return null; } }
function setSession(id) { try { id ? localStorage.setItem(SESSION_KEY, id) : localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ } authListeners.forEach(cb => cb(id ? 'SIGNED_IN' : 'SIGNED_OUT')); }
function publicUser(u) { return u ? { id: u.id, email: u.email, firstName: u.firstName, role: u.role } : null; }
function currentUser() { const id = sessionUserId(); return publicUser(load().users.find(u => u.id === id)); }
function requireUser() { const u = currentUser(); if (!u) throw new Error('not_authenticated'); return u; }
function requireAdmin() { const u = requireUser(); if (u.role !== 'admin') throw new Error('not_authorized'); return u; }

// ---------- mídia (IndexedDB) ----------
let idb;
function openIdb() {
  if (idb) return idb;
  idb = new Promise((resolve, reject) => {
    const req = indexedDB.open('der-media', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('files');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return idb;
}
async function idbPut(key, blob) { const db = await openIdb(); return new Promise((res, rej) => { const tx = db.transaction('files', 'readwrite'); tx.objectStore('files').put(blob, key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); }
async function idbGet(key) { const db = await openIdb(); return new Promise((res, rej) => { const r = db.transaction('files').objectStore('files').get(key); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
const urlCache = new Map();
async function mediaUrl(path) {
  if (!path) return null;
  if (urlCache.has(path)) return urlCache.get(path);
  try { const blob = await idbGet(path); if (!blob) return null; const url = URL.createObjectURL(blob); urlCache.set(path, url); return url; } catch { return null; }
}
async function withMedia(list) { return Promise.all(list.map(async r => ({ ...r, mediaUrl: await mediaUrl(r.mediaPath) }))); }

const byNewest = (a, b) => new Date(b.createdAt) - new Date(a.createdAt);
const byOldest = (a, b) => new Date(a.createdAt) - new Date(b.createdAt);
function canSee(r, u) { return r.status === 'approved' || (u && (r.userId === u.id || u.role === 'admin')); }

// ---------- API ----------
export const localAdapter = {
  mode: 'local',

  auth: {
    async getUser() { await ready; return currentUser(); },
    async signUp({ email, password, firstName }) {
      await ready;
      email = String(email).trim().toLowerCase();
      if (password.length < 8) throw new Error('weak-password');
      if (load().users.some(u => u.email === email)) throw new Error('email-in-use');
      const salt = uuid();
      const user = { id: uuid(), email, firstName: firstName.trim().slice(0, 40), role: 'user', salt, passwordHash: await hashPassword(password, salt), createdAt: new Date().toISOString() };
      mutate(db => db.users.push(user));
      setSession(user.id);
      return { user: publicUser(user), needsConfirmation: false };
    },
    async signIn({ email, password }) {
      await ready;
      const u = load().users.find(x => x.email === String(email).trim().toLowerCase());
      if (!u || (await hashPassword(password, u.salt)) !== u.passwordHash) throw new Error('invalid-credentials');
      setSession(u.id);
      return publicUser(u);
    },
    async signOut() { setSession(null); },
    async resetPassword() { throw new Error('local-reset-unavailable'); },
    async updatePassword(password) {
      const u = requireUser(); if (password.length < 8) throw new Error('weak-password');
      const salt = uuid(); const passwordHash = await hashPassword(password, salt);
      mutate(db => { const x = db.users.find(y => y.id === u.id); x.salt = salt; x.passwordHash = passwordHash; });
    },
    onChange(cb) { authListeners.add(cb); return () => authListeners.delete(cb); }
  },

  reviews: {
    async listApproved(productId) {
      return withMedia(load().reviews.filter(r => r.status === 'approved' && (!productId || r.productId === productId)).sort(byNewest));
    },
    async get(id) {
      const r = load().reviews.find(x => x.id === id);
      return r && canSee(r, currentUser()) ? (await withMedia([r]))[0] : null;
    },
    async listMine() {
      const u = requireUser();
      return withMedia(load().reviews.filter(r => r.userId === u.id).sort(byNewest));
    },
    async create({ productId, text, sport, level, frequency, mediaFile, mediaKind, mediaConsent }) {
      const u = requireUser();
      const id = uuid();
      let mediaPath = null;
      if (mediaFile) {
        if (!mediaConsent) throw new Error('media-consent-required');
        mediaPath = `${u.id}/${id}-${mediaFile.name.replace(/[^\w.-]/g, '_').slice(-60)}`;
        await idbPut(mediaPath, mediaFile);
      }
      const review = { id, userId: u.id, productId, authorName: u.firstName, sport, level, frequency, rating: null, text: text.trim(), context: null, mediaType: mediaFile ? mediaKind : null, mediaPath, mediaConsent: !!mediaFile, status: 'pending', moderationNote: null, moderatedAt: null, createdAt: new Date().toISOString(), isDemo: false };
      mutate(db => db.reviews.push(review));
      return review;
    }
  },

  points: {
    async ledger() {
      const u = requireUser();
      return load().ledger.filter(l => l.userId === u.id).sort(byNewest);
    }
  },

  redemptions: {
    async list() {
      const u = requireUser();
      return load().redemptions.filter(r => r.userId === u.id).sort(byNewest);
    },
    async redeem(benefitId, operationId) {
      const u = requireUser();
      return mutate(db => {
        const prev = db.redemptions.find(r => r.id === operationId);
        const bal = () => db.ledger.filter(l => l.userId === u.id).reduce((s, l) => s + l.points, 0);
        if (prev) return prev.userId === u.id && prev.benefitId === benefitId ? { ok: true, duplicate: true, redemption: prev, balance: bal() } : { ok: false, reason: 'invalid-operation' };
        const b = benefitById(benefitId);
        if (!b) return { ok: false, reason: 'unknown-benefit' };
        const balance = bal();
        if (balance < b.cost) return { ok: false, reason: 'insufficient-points', balance };
        const code = b.id === 'antecipado' ? null : `DEMO-${b.id === 'frete' ? 'FRETE' : '5OFF'}-${operationId.replace(/[^a-z0-9]/gi, '').slice(-8).toUpperCase()}`;
        const redemption = { id: operationId, userId: u.id, benefitId: b.id, title: b.title, cost: b.cost, code, createdAt: new Date().toISOString() };
        db.redemptions.push(redemption);
        db.ledger.push({ id: uuid(), userId: u.id, points: -b.cost, reason: 'redemption', reviewId: null, redemptionId: operationId, description: b.title, createdAt: redemption.createdAt });
        return { ok: true, duplicate: false, redemption, balance: balance - b.cost };
      });
    }
  },

  admin: {
    async listReviews(status) {
      requireAdmin();
      const list = load().reviews.filter(r => !r.isDemo && (!status || r.status === status));
      return withMedia(list.sort(status === 'pending' ? byOldest : byNewest));
    },
    async counts() {
      requireAdmin();
      const c = { pending: 0, approved: 0, rejected: 0 };
      load().reviews.filter(r => !r.isDemo).forEach(r => c[r.status]++);
      return c;
    },
    async moderate(id, decision, note) {
      const admin = requireAdmin();
      if (!['approved', 'rejected'].includes(decision)) throw new Error('invalid_decision');
      return mutate(db => {
        const r = db.reviews.find(x => x.id === id);
        if (!r || r.status !== 'pending') throw new Error('review_not_pending');
        r.status = decision; r.moderatedAt = new Date().toISOString(); r.moderatedBy = admin.id; r.moderationNote = (note || '').trim() || null;
        if (decision === 'approved' && r.userId && !db.ledger.some(l => l.reviewId === r.id)) {
          db.ledger.push({ id: uuid(), userId: r.userId, points: POINTS_PER_REVIEW, reason: 'review_approved', reviewId: r.id, redemptionId: null, description: 'Avaliação aprovada', createdAt: r.moderatedAt });
        }
        return r;
      });
    }
  },

  subscribe(cb) { listeners.add(cb); return () => listeners.delete(cb); }
};
