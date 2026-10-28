// Adaptador Supabase: autenticação, banco Postgres com RLS, Storage e Realtime.
// Regras sensíveis (crédito de pontos e resgate) rodam no banco via funções RPC atômicas.
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';
import { uuid } from '../lib/ui.js';

const BUCKET = 'review-media';
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    // Sessão separada no painel admin: moderar não desconecta a conta usada no app.
    storageKey: location.pathname.endsWith('admin.html') ? 'der-admin-auth' : 'der-app-auth',
    persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' }
});

const toReview = r => r && ({
  id: r.id, userId: r.user_id, productId: r.product_id, authorName: r.author_name, sport: r.sport, level: r.level,
  frequency: r.frequency, rating: r.rating, text: r.body, context: r.usage_context, mediaType: r.media_type,
  mediaPath: r.media_path, status: r.status, moderationNote: r.moderation_note, moderatedAt: r.moderated_at,
  createdAt: r.created_at, isDemo: r.is_demo
});
const toLedger = l => ({ id: l.id, points: l.points, reason: l.reason, reviewId: l.review_id, redemptionId: l.redemption_id, description: l.description, createdAt: l.created_at });
const toRedemption = r => r && ({ id: r.id, benefitId: r.benefit_id, title: r.title, cost: r.cost, code: r.code, createdAt: r.created_at });

function check({ data, error }) { if (error) throw error; return data; }

async function withMedia(rows) {
  const list = rows.map(toReview);
  const paths = list.map(r => r.mediaPath).filter(Boolean);
  if (!paths.length) return list.map(r => ({ ...r, mediaUrl: null }));
  const { data } = await sb.storage.from(BUCKET).createSignedUrls(paths, 3600);
  const map = new Map((data || []).filter(x => x.signedUrl).map(x => [x.path, x.signedUrl]));
  return list.map(r => ({ ...r, mediaUrl: map.get(r.mediaPath) || null }));
}

let profileCache = null;
async function getUser() {
  const { data: { session } } = await sb.auth.getSession();
  const u = session?.user;
  if (!u) { profileCache = null; return null; }
  if (profileCache?.id === u.id) return profileCache;
  const { data: p } = await sb.from('profiles').select('first_name, role').eq('id', u.id).maybeSingle();
  profileCache = { id: u.id, email: u.email, firstName: p?.first_name || u.user_metadata?.first_name || 'Você', role: p?.role || 'user' };
  return profileCache;
}
async function requireUser() { const u = await getUser(); if (!u) throw new Error('not_authenticated'); return u; }

const redirectTo = () => `${location.origin}${location.pathname}`;

export const supabaseAdapter = {
  mode: 'supabase',

  auth: {
    getUser,
    async signUp({ email, password, firstName }) {
      const data = check(await sb.auth.signUp({ email, password, options: { data: { first_name: firstName.trim().slice(0, 40) }, emailRedirectTo: `${redirectTo()}?screen=conta` } }));
      profileCache = null;
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) throw new Error('email-in-use');
      return { user: data.session ? await getUser() : null, needsConfirmation: !data.session };
    },
    async signIn({ email, password }) { check(await sb.auth.signInWithPassword({ email, password })); profileCache = null; return getUser(); },
    async signOut() { profileCache = null; await sb.auth.signOut(); },
    async resetPassword(email) { check(await sb.auth.resetPasswordForEmail(email, { redirectTo: `${redirectTo()}?screen=nova-senha` })); },
    async updatePassword(password) { check(await sb.auth.updateUser({ password })); },
    onChange(cb) {
      const { data } = sb.auth.onAuthStateChange((event) => { if (event !== 'TOKEN_REFRESHED') profileCache = null; setTimeout(() => cb(event), 0); });
      return () => data.subscription.unsubscribe();
    }
  },

  reviews: {
    async listApproved(productId) {
      let q = sb.from('reviews').select('*').eq('status', 'approved').order('created_at', { ascending: false });
      if (productId) q = q.eq('product_id', productId);
      return withMedia(check(await q));
    },
    async get(id) {
      const row = check(await sb.from('reviews').select('*').eq('id', id).maybeSingle());
      return row ? (await withMedia([row]))[0] : null;
    },
    async listMine() {
      const u = await requireUser();
      return withMedia(check(await sb.from('reviews').select('*').eq('user_id', u.id).order('created_at', { ascending: false })));
    },
    async create({ productId, text, sport, level, frequency, mediaFile, mediaKind, mediaConsent }) {
      const u = await requireUser();
      let mediaPath = null;
      if (mediaFile) {
        if (!mediaConsent) throw new Error('media-consent-required');
        const ext = (mediaFile.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5);
        mediaPath = `${u.id}/${uuid()}.${ext}`;
        check(await sb.storage.from(BUCKET).upload(mediaPath, mediaFile, { contentType: mediaFile.type, upsert: false }));
      }
      const { data, error } = await sb.from('reviews').insert({
        product_id: productId, body: text.trim(), sport, level, frequency,
        media_type: mediaFile ? mediaKind : null, media_path: mediaPath, media_consent: !!mediaFile
      }).select('*').single();
      if (error) { if (mediaPath) await sb.storage.from(BUCKET).remove([mediaPath]); throw error; }
      return toReview(data);
    }
  },

  points: {
    async ledger() {
      const u = await requireUser();
      return check(await sb.from('points_ledger').select('*').eq('user_id', u.id).order('created_at', { ascending: false })).map(toLedger);
    }
  },

  redemptions: {
    async list() {
      const u = await requireUser();
      return check(await sb.from('redemptions').select('*').eq('user_id', u.id).order('created_at', { ascending: false })).map(toRedemption);
    },
    async redeem(benefitId, operationId) {
      const res = check(await sb.rpc('redeem_benefit', { p_operation_id: operationId, p_benefit_id: benefitId }));
      return { ...res, redemption: toRedemption(res.redemption) };
    }
  },

  admin: {
    async listReviews(status) {
      let q = sb.from('reviews').select('*').eq('is_demo', false).order('created_at', { ascending: status === 'pending' });
      if (status) q = q.eq('status', status);
      return withMedia(check(await q));
    },
    async counts() {
      const out = {};
      await Promise.all(['pending', 'approved', 'rejected'].map(async s => {
        const { count, error } = await sb.from('reviews').select('id', { count: 'exact', head: true }).eq('is_demo', false).eq('status', s);
        if (error) throw error; out[s] = count || 0;
      }));
      return out;
    },
    async moderate(id, decision, note) {
      return toReview(check(await sb.rpc('moderate_review', { p_review_id: id, p_decision: decision, p_note: note || null })));
    }
  },

  // Realtime: o Supabase só entrega eventos de linhas que a pessoa pode ver (RLS).
  subscribe(cb) {
    let timer;
    const debounced = () => { clearTimeout(timer); timer = setTimeout(cb, 150); };
    const ch = sb.channel(`der-${uuid()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reviews' }, debounced)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'points_ledger' }, debounced)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'redemptions' }, debounced)
      .subscribe();
    return () => sb.removeChannel(ch);
  }
};
