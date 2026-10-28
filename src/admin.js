import './styles.css';
import { db } from './data/index.js';
import { LOCAL_ADMIN } from './config.js';
import { POINTS_PER_REVIEW, productById } from './lib/catalog.js';
import { precheck } from './lib/precheck.js';
import { escape as e, icon, dateTime, toast, friendlyError, STATUS_LABEL } from './lib/ui.js';

const root = document.querySelector('#admin');
let user = null, tab = 'pending', busy = false;

function header() {
  return `<nav class="research-nav"><span class="brand">EXPERIENCE REWARDS</span><a href="${import.meta.env.BASE_URL}">Aplicativo</a>${user ? `<span class="admin-user">${icon('user')} ${e(user.firstName)} · ${e(user.email)}</span><button class="btn secondary small" data-action="logout">Sair</button>` : ''}</nav>`;
}

function loginView(message = '') {
  root.innerHTML = `${header()}<h1>Painel de moderação</h1><p class="lead">Acesso restrito à equipe de moderação. Entre com uma conta que tenha o papel de moderação.</p><div class="research-card" style="max-width:460px"><form id="admin-login" novalidate><div class="field"><label for="email">E-mail</label><input id="email" type="email" autocomplete="username" required></div><div class="field"><label for="password">Senha</label><input id="password" type="password" autocomplete="current-password" required></div><p id="login-message" class="field-error ${message ? 'show' : ''}" role="alert">${e(message)}</p><button class="btn full" type="submit">Entrar no painel</button></form>${db.mode === 'local' ? `<div class="notice">${icon('info')}<span>Modo local: use <strong>${e(LOCAL_ADMIN.email)}</strong> com a senha definida em <code>VITE_LOCAL_ADMIN_PASSWORD</code> (padrão no README).</span></div>` : ''}</div>`;
  root.querySelector('#admin-login').addEventListener('submit', async ev => {
    ev.preventDefault();
    const btn = ev.target.querySelector('button'); btn.disabled = true;
    try {
      user = await db.auth.signIn({ email: root.querySelector('#email').value.trim(), password: root.querySelector('#password').value });
      render();
    } catch (err) { loginView(friendlyError(err)); }
  });
}

function flagsView(text) {
  const flags = precheck(text);
  if (!flags.length) return `<div class="flags"><span class="flag ok">${icon('check')} Pré-análise automática: nenhum alerta</span></div>`;
  return `<div class="flags">${flags.map(f => `<span class="flag ${f.level}">${icon('flag')} ${e(f.label)}</span>`).join('')}</div>`;
}

function mediaView(r) {
  if (!r.mediaType) return '';
  if (!r.mediaUrl) return `<div class="media-preview">${icon(r.mediaType === 'photo' ? 'photo' : 'video')} Arquivo não encontrado</div>`;
  return r.mediaType === 'photo'
    ? `<a href="${e(r.mediaUrl)}" target="_blank" rel="noopener"><img class="review-media" src="${e(r.mediaUrl)}" alt="Foto enviada por ${e(r.authorName)}"></a>`
    : `<video class="review-media" src="${e(r.mediaUrl)}" controls playsinline preload="metadata"></video>`;
}

function card(r) {
  const pending = r.status === 'pending';
  return `<article class="admin-review" id="r-${e(r.id)}"><header><strong>${e(productById(r.productId).short)} · ${e(r.authorName)}</strong><span class="pill ${r.status}">${STATUS_LABEL[r.status]}</span></header><div class="meta"><span class="pill">${e(r.sport)}</span><span class="pill">${e(r.level)}</span><span class="pill">${e(r.frequency)}</span><span class="pill">${icon('clock')} ${dateTime(r.createdAt)}</span>${r.mediaType ? `<span class="pill">${icon(r.mediaType === 'photo' ? 'photo' : 'video')} ${r.mediaType === 'photo' ? 'Foto' : 'Vídeo'} · uso público autorizado</span>` : ''}</div><p>${e(r.text)}</p>${mediaView(r)}${flagsView(r.text)}${pending ? `<label class="sr-only" for="note-${e(r.id)}">Observação para a pessoa autora</label><textarea id="note-${e(r.id)}" maxlength="300" placeholder="Observação para a pessoa autora (opcional; recomendada em caso de rejeição)"></textarea><div class="actions"><button class="btn green small" data-decision="approved" data-id="${e(r.id)}">${icon('check')} Aprovar e creditar ${POINTS_PER_REVIEW} pontos</button><button class="btn danger small" data-decision="rejected" data-id="${e(r.id)}">${icon('close')} Rejeitar</button></div>` : `<p class="subtle">${r.status === 'approved' ? `Publicada em ${dateTime(r.moderatedAt)}. Crédito de ${POINTS_PER_REVIEW} pontos registrado uma única vez.` : `Rejeitada em ${dateTime(r.moderatedAt)}.`}${r.moderationNote ? ` Observação: “${e(r.moderationNote)}”` : ''}</p>`}</article>`;
}

async function render() {
  user = await db.auth.getUser().catch(() => null);
  if (!user) return loginView();
  if (user.role !== 'admin') {
    root.innerHTML = `${header()}<h1>Acesso restrito</h1><div class="notice warning">${icon('shield')}<span>Sua conta não tem permissão de moderação. Peça a um administrador do projeto para liberar o acesso.</span></div>`;
    return;
  }
  try {
    const [counts, list] = await Promise.all([db.admin.counts(), db.admin.listReviews(tab)]);
    const tabs = [['pending', 'Pendentes'], ['approved', 'Aprovadas'], ['rejected', 'Rejeitadas']];
    root.innerHTML = `${header()}<h1>Painel de moderação</h1><p class="lead">Analise relatos e mídias antes da publicação. A aprovação publica a avaliação e credita ${POINTS_PER_REVIEW} pontos automaticamente no extrato da pessoa autora.</p><div class="notice">${icon('info')}<span>A pré-análise automática sinaliza possíveis dados pessoais, links e linguagem imprópria. Ela apoia, mas não substitui, a decisão humana.</span></div><div class="admin-tabs" role="tablist">${tabs.map(([id, label]) => `<button class="chip ${tab === id ? 'active' : ''}" role="tab" aria-selected="${tab === id}" data-tab="${id}">${label}<span class="count">${counts[id] ?? 0}</span></button>`).join('')}</div>${list.length ? list.map(card).join('') : `<div class="empty" style="margin-top:18px">${tab === 'pending' ? 'Nenhuma avaliação aguardando moderação. 🎉' : 'Nada por aqui ainda.'}</div>`}`;
  } catch (err) {
    console.error(err);
    root.innerHTML = `${header()}<h1>Painel de moderação</h1><div class="notice warning">${e(friendlyError(err))}</div><button class="btn" data-action="retry">Tentar novamente</button>`;
  }
}

root.addEventListener('click', async ev => {
  const b = ev.target.closest('button'); if (!b) return;
  if (b.dataset.tab) { tab = b.dataset.tab; render(); return; }
  if (b.dataset.action === 'logout') { await db.auth.signOut(); user = null; render(); return; }
  if (b.dataset.action === 'retry') { render(); return; }
  if (b.dataset.decision && !busy) {
    const id = b.dataset.id, decision = b.dataset.decision;
    const note = root.querySelector(`#note-${CSS.escape(id)}`)?.value || '';
    busy = true; b.closest('.actions').querySelectorAll('button').forEach(x => { x.disabled = true; });
    try {
      await db.admin.moderate(id, decision, note);
      toast(decision === 'approved' ? `Avaliação aprovada e publicada. +${POINTS_PER_REVIEW} pontos creditados.` : 'Avaliação rejeitada. Nenhum ponto creditado.');
    } catch (err) { toast(friendlyError(err)); }
    busy = false; render();
  }
});

db.subscribe(() => { if (!busy && !document.activeElement?.matches('textarea')) render(); });
render();
