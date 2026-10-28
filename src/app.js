import './styles.css';
import { db, balanceOf } from './data/index.js';
import { APP_VERSION } from './config.js';
import { POINTS_PER_REVIEW, MODERATION_SLA, SPORTS, LEVELS, FREQUENCIES, REVIEW_MIN, REVIEW_MAX, MEDIA_RULES, mediaKind, products, benefits, benefitById, asset } from './lib/catalog.js';
import { personalDataFlags } from './lib/precheck.js';
import { escape as e, icon, date, initials, avatarColor, uuid, toast, formatBytes, friendlyError } from './lib/ui.js';

const app = document.querySelector('#app');
const modalRoot = document.querySelector('#modal-root');
const PRODUCT_ID = 'fleece';
const AUTH_SCREENS = ['avaliar', 'enviada', 'status', 'minhas', 'beneficios', 'ofertas', 'conta'];
const FORM_SCREENS = ['avaliar', 'entrar', 'nova-senha', 'recuperar'];

let user = null;
let cache = { ledger: [], redemptions: [] };
let formFile = null, formPreviewUrl = null, modalFocus, renderSeq = 0, knownCredits = null, submitting = false;

// ---------------------------------------------------------------- navegação
const params = () => new URL(location.href).searchParams;
const screen = () => params().get('screen') || 'produto';
const currentId = () => params().get('id');

function nav(to, id = null, { replace = false, scroll = true, next = null } = {}) {
  if (modalRoot.firstChild) closeModal(false);
  const u = new URL(location.href);
  u.search = '';
  u.searchParams.set('screen', to);
  if (id) u.searchParams.set('id', id);
  if (next) u.searchParams.set('next', next);
  history[replace ? 'replaceState' : 'pushState']({}, '', u.pathname + u.search);
  render().then(() => {
    if (scroll) window.scrollTo(0, 0);
    const heading = document.querySelector('#conteudo h1');
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
  });
}

function goAfterLogin() {
  const p = params();
  const next = p.get('next');
  nav(next && next !== 'entrar' ? next : 'conta', p.get('nextId'), { replace: true });
}

// ---------------------------------------------------------------- dados do usuário
async function loadWallet() {
  if (!user) { cache = { ledger: [], redemptions: [] }; return cache; }
  const [ledger, redemptions] = await Promise.all([db.points.ledger(), db.redemptions.list()]);
  cache = { ledger, redemptions };
  const credits = ledger.filter(l => l.reason === 'review_approved').length;
  if (knownCredits !== null && credits > knownCredits) toast(`+${POINTS_PER_REVIEW} pontos! Uma avaliação sua foi aprovada.`);
  knownCredits = credits;
  return cache;
}
const balance = () => balanceOf(cache.ledger);

// ---------------------------------------------------------------- layout
function actionButton(action, label, cls = 'btn', extra = '') { return `<button class="${cls}" data-action="${action}" ${extra}>${label}</button>`; }

function shell(content, title, tab = 'explorar', { back = true } = {}) {
  const navs = [['home', 'Início', 'home'], ['explorar', 'Explorar', 'search'], ['descontos', 'Descontos', 'tag'], ['clube', 'Clube', 'club'], ['carrinho', 'Carrinho', 'bag']];
  const account = user ? 'conta' : 'entrar';
  const accountLabel = user ? `Minha conta (${e(user.firstName)})` : 'Entrar ou criar conta';
  return `<div class="shell"><div class="demo-ribbon">${icon('info')} Projeto acadêmico FIAP · produtos, preços e benefícios demonstrativos${db.mode === 'local' ? ' · dados salvos neste navegador' : ''}</div><header class="desktop-header"><button class="brand iconbtn" data-go="home" style="width:auto;border-radius:0"><span class="brand-symbol">◒</span>DECATHLON</button><form class="searchbox" data-search>${icon('search')}<input aria-label="Buscar produtos" placeholder="Busque por 'blusa de trilha'"><button class="iconbtn" aria-label="Pesquisar">${icon('arrow')}</button></form><div class="header-actions">${user ? `<span class="hello">Olá, ${e(user.firstName)}</span>` : `<button class="btn outline small" data-go="entrar">Entrar</button>`}<button class="iconbtn" data-go="${account}" aria-label="${accountLabel}">${icon('user')}</button><button class="iconbtn" data-go="clube" aria-label="Meus pontos">${icon('club')}</button><button class="iconbtn" data-go="carrinho" aria-label="Carrinho">${icon('bag')}</button></div></header><header class="topbar">${back ? `<button class="iconbtn" data-action="back" aria-label="Voltar">${icon('back')}</button>` : `<span class="brand mobile-only" style="font-size:17px">DECATHLON</span>`}<h1>${title}</h1><button class="iconbtn" data-go="${account}" aria-label="${accountLabel}">${icon('user')}</button></header><main id="conteudo">${content}</main><div class="footer-note">Estudo independente da FIAP Pós-Tech. Este aplicativo não é um serviço oficial da Decathlon. Pontos, relatos de exemplo e benefícios são demonstrativos. <a href="?screen=privacidade">Privacidade e dados</a></div><nav class="bottom-nav" aria-label="Navegação principal">${navs.map(([to, label, ic]) => `<button data-go="${to}" class="${tab === to ? 'active' : ''}" ${tab === to ? 'aria-current="page"' : ''}>${icon(ic)}<span>${label}</span></button>`).join('')}</nav></div>`;
}

function mediaBlock(r, cls = '') {
  if (!r.mediaType) return '';
  if (!r.mediaUrl) return `<div class="media-preview ${cls}">${icon(r.mediaType === 'photo' ? 'photo' : 'video')} ${r.mediaType === 'photo' ? 'Foto' : 'Vídeo'} indisponível no momento</div>`;
  return r.mediaType === 'photo'
    ? `<img class="review-media ${cls}" src="${e(r.mediaUrl)}" alt="Foto do produto em uso enviada por ${e(r.authorName)}" loading="lazy">`
    : `<video class="review-media ${cls}" src="${e(r.mediaUrl)}" controls playsinline preload="metadata" aria-label="Vídeo do produto em uso enviado por ${e(r.authorName)}"></video>`;
}

function reviewCard(r) {
  const mine = user && r.userId === user.id;
  return `<article class="review-card"><header class="review-author"><div class="avatar" style="background:${avatarColor(r.authorName + r.id)}">${e(initials(r.authorName))}</div><div><strong>${e(r.authorName)}</strong><small>${e(r.sport)} · ${e(r.level)}</small></div>${r.isDemo ? '<span class="pill demo" style="margin-left:auto">Exemplo</span>' : mine ? '<span class="pill approved" style="margin-left:auto">Sua avaliação</span>' : ''}</header>${r.rating ? `<div class="stars" aria-label="${r.rating} de 5 estrelas">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</div>` : ''}<p>${e(r.text)}</p><button class="profile-button" data-go="perfil" data-id="${e(r.id)}">${icon('user')} ${e(r.sport)} · ${e(r.frequency)} ${icon('arrow')}</button>${mediaBlock(r)}<div class="review-foot"><span>${r.isDemo ? 'Relato de exemplo' : 'Aprovado pela moderação'}</span><span>${date(r.createdAt)}</span></div></article>`;
}

function reviewsSection(list, full = false) {
  const filter = params().get('filter') || 'todos';
  const shown = filter === 'todos' ? list : list.filter(r => r.sport === filter);
  const sports = ['todos', ...SPORTS.filter(s => list.some(r => r.sport === s))];
  return `<section class="section ${full ? 'reviews-page' : ''}" id="experiencias"><div class="section-head"><div><div class="eyebrow">Experience Rewards</div><h2>Experiências de quem pratica</h2><p class="intro">Veja o contexto de uso e encontre pessoas com uma rotina parecida com a sua.</p></div>${actionButton('write-review', 'Avaliar produto', 'btn outline small')}</div><div class="chips" aria-label="Filtrar avaliações por esporte">${sports.map(f => `<button class="chip ${f === filter ? 'active' : ''}" data-filter="${f}" aria-pressed="${f === filter}">${f === 'todos' ? 'Todas as experiências' : f}</button>`).join('')}</div><div class="reviews-grid">${(full ? shown : shown.slice(0, 3)).map(reviewCard).join('') || '<div class="empty">Nenhuma experiência neste filtro. Experimente outra modalidade.</div>'}</div>${!full ? `<button class="btn secondary full" data-go="avaliacoes" style="margin-top:20px">Ver todas as ${list.length} experiências ${icon('arrow')}</button>` : ''}</section>`;
}

// ---------------------------------------------------------------- telas
async function product() {
  const list = await db.reviews.listApproved(PRODUCT_ID);
  const p = products[0];
  return shell(`<div class="breadcrumbs"><button class="rating-link" data-go="home">Início</button>${icon('arrow')}Trilha${icon('arrow')}Fleeces${icon('arrow')}MH100</div><div class="product-grid"><div class="gallery"><div class="gallery-main"><img id="main-photo" src="${asset('fleece-main.webp')}" alt="Blusa fleece preta MH100 usada por um modelo em imagem de catálogo"><button class="gallery-badge" data-action="gallery">${icon('plus')} 3 fotos</button></div><div class="thumbs">${['fleece-main', 'fleece-front', 'fleece-back'].map((img, i) => `<button data-photo="${img}" class="${i === 0 ? 'selected' : ''}" aria-label="Ver foto ${i + 1} do produto"><img src="${asset(img + '.webp')}" alt="Vista ${i + 1} da blusa"></button>`).join('')}</div></div><div class="product-details"><div class="brand-label">${p.brand}</div><h1>${p.name}</h1><div class="rating-line"><span class="stars" aria-hidden="true">★★★★★</span><strong>4,7</strong><button class="rating-link" data-go="avaliacoes">${list.length} experiências</button><span class="subtle">REF: 8606098</span></div><div class="caption">Nota e preço ilustrativos.</div><div class="price-panel"><small>NO PIX OU À VISTA</small><div class="price">R$ ${p.price}</div></div><p class="installments">3x de R$ 49,99 sem juros</p><div class="cashback">${icon('tag')} +5% de volta de cashback · exemplo de catálogo</div><div class="choice-label"><strong>Cor</strong><span>Preta</span></div><div class="choice-label"><strong>Tamanho</strong><span id="size-label">M</span></div><div class="size-row" role="group" aria-label="Tamanho">${['PP', 'P', 'M', 'G', 'GG'].map(s => `<button class="size-btn ${s === 'M' ? 'selected' : ''}" data-size="${s}" aria-pressed="${s === 'M'}">${s}</button>`).join('')}</div><div class="fit-note">Modelagem justa. Compare experiências e tamanhos antes de escolher.</div><div class="buy-row">${actionButton('cart', 'Adicionar ao carrinho', 'btn full')}</div><div class="caption">Compra demonstrativa, sem checkout real.</div><div class="rewards-invite">${icon('sparkles')}<div><strong>Sua experiência vale pontos</strong><p>Conte como usa o produto e ganhe ${POINTS_PER_REVIEW} pontos após aprovação.</p></div>${actionButton('write-review', 'Avaliar', 'btn small')}</div></div></div>${reviewsSection(list)}<section class="section"><h2>Feita para acompanhar sua trilha</h2><p class="intro">Fleece leve para frio moderado, com zíper para ajustar a ventilação. Use as experiências dos praticantes para entender os contextos de uso.</p><div class="notice">${icon('info')} Características e informações de compra usadas como contexto demonstrativo. Não há compra ou cashback real.</div></section>`, 'Produto', 'explorar');
}

async function allReviews() { return shell(reviewsSection(await db.reviews.listApproved(PRODUCT_ID), true), 'Experiências do produto'); }

async function profile() {
  const r = await db.reviews.get(currentId());
  if (!r) return missing();
  return shell(`<div class="content-narrow"><div class="profile-hero"><div class="avatar" style="background:${avatarColor(r.authorName + r.id)}">${e(initials(r.authorName))}</div><h1>A experiência de ${e(r.authorName)}</h1><span class="pill demo">${r.isDemo ? 'Perfil e relato de exemplo' : r.status === 'approved' ? 'Avaliação aprovada pela moderação' : 'Visível apenas para você até a aprovação'}</span></div><h2 style="font-size:18px">O contexto de quem avaliou</h2><div class="profile-facts"><div><small>Esporte</small><strong>${e(r.sport)}</strong></div><div><small>Experiência</small><strong>${e(r.level)}</strong></div><div><small>Frequência</small><strong>${e(r.frequency)}</strong></div></div><h2 style="font-size:18px">Como usa o produto</h2><p class="subtle">${e(r.context || 'Relato sobre a blusa de trilha MH100')}</p><blockquote class="quote">“${e(r.text)}”</blockquote>${mediaBlock(r, 'large')}<div class="notice">${icon('shield')} Este perfil mostra somente o primeiro nome, o esporte, o nível e a rotina de prática necessários para entender a avaliação.</div><button class="btn outline full" data-go="avaliacoes">Voltar às experiências</button></div>`, 'Perfil esportivo', 'explorar');
}

function selectField(id, label, placeholder, options) {
  return `<div class="field"><label for="${id}">${label}</label><select id="${id}" name="${id}" aria-describedby="${id}-error" required><option value="">${placeholder}</option>${options.map(x => `<option>${x}</option>`).join('')}</select><p id="${id}-error" class="field-error">${placeholder.replace('Selecione', 'Selecione')}.</p></div>`;
}

function form() {
  clearFormFile();
  return shell(`<div class="content-narrow"><div class="eyebrow">Compartilhe sua experiência</div><h1>Como este produto acompanha você?</h1><p class="intro">Ajude outras pessoas a escolher. Uma experiência aprovada gera <strong>${POINTS_PER_REVIEW} pontos</strong>.</p><div class="form-product"><img src="${asset('fleece-front.webp')}" alt="Blusa fleece preta"><div><strong>Blusa de Trilha MH100</strong><small>Quechua · Preta</small></div></div><form id="review-form" novalidate><div class="field"><label for="review-text">Sua experiência com o produto</label><textarea id="review-text" name="text" maxlength="${REVIEW_MAX}" rows="5" placeholder="Conte onde usou a blusa, o que funcionou e o que poderia melhorar." aria-describedby="text-hint text-error" required></textarea><small id="text-hint"><span id="char-count">0 caracteres</span> · mínimo ${REVIEW_MIN}, máximo ${REVIEW_MAX}. Não inclua e-mail, telefone ou documentos.</small><p id="text-error" class="field-error">Conte sua experiência antes de enviar.</p></div><div class="field-label">Seu perfil esportivo</div><p class="subtle">Assim, outras pessoas conseguem entender o contexto da sua avaliação.</p>${selectField('sport', 'Qual esporte você pratica?', 'Selecione o esporte', SPORTS)}<div class="form-grid">${selectField('level', 'Nível de experiência', 'Selecione o nível', LEVELS)}${selectField('frequency', 'Frequência de prática', 'Selecione a frequência', FREQUENCIES)}</div><div class="field"><div class="field-label">Foto ou vídeo <span class="subtle">(opcional)</span></div><input id="media-file" class="sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,video/mp4,video/quicktime,video/webm" aria-describedby="media-hint media-error"><label class="media-drop" for="media-file">${icon('upload')}<span><strong>Escolher foto ou vídeo</strong><small id="media-hint">Foto até ${formatBytes(MEDIA_RULES.photo.maxBytes)} (JPG, PNG, WEBP, HEIC) · vídeo até ${formatBytes(MEDIA_RULES.video.maxBytes)} (MP4, MOV, WEBM)</small></span></label><div id="media-selected"></div><p id="media-error" class="field-error" role="alert"></p><div id="media-consent-wrap" hidden><div class="check-row"><input id="media-consent" type="checkbox" aria-describedby="media-consent-error"><label for="media-consent">Autorizo a exibição pública desta foto ou vídeo na página do produto após a aprovação. Confirmo que o conteúdo não mostra outras pessoas identificáveis nem dados pessoais.</label></div><p id="media-consent-error" class="field-error">Para enviar a mídia, autorize a exibição pública ou remova o arquivo.</p></div></div><div class="notice">${icon('clock')} A equipe de moderação do Experience Rewards analisa seu relato em até ${MODERATION_SLA}. Ele só será publicado após aprovação, quando você receberá ${POINTS_PER_REVIEW} pontos automaticamente.</div><div class="check-row"><input id="profile-consent" name="consent" type="checkbox" aria-describedby="consent-error"><label for="profile-consent">Entendi que meu primeiro nome, meu texto e meu perfil esportivo aparecerão juntos na página do produto após a aprovação.</label></div><p id="consent-error" class="field-error">Confirme que entendeu como o perfil será exibido.</p><button class="btn full" type="submit" id="submit-review">Enviar minha experiência ${icon('arrow')}</button></form></div>`, 'Avaliar produto', 'explorar');
}

async function sent() {
  const r = await db.reviews.get(currentId());
  if (!r || r.status !== 'pending') return status();
  return shell(`<div class="content-narrow"><div class="status-hero"><div class="status-icon approved">${icon('check')}</div><h1>Avaliação enviada!</h1></div><div class="submission-copy"><p>A equipe de moderação do Experience Rewards vai analisar seu relato em até <strong>${MODERATION_SLA}</strong>. Durante esse período, ele ficará aguardando análise e ainda não aparecerá na página do produto.</p><p>Se aprovado, seu relato será publicado e <strong>${POINTS_PER_REVIEW} pontos serão adicionados automaticamente ao seu saldo</strong>.</p><p>Você não precisa fazer mais nada agora. Acompanhe o resultado em <strong>Minhas avaliações</strong>.</p></div><button class="btn full" data-go="status" data-id="${e(r.id)}">Acompanhar minha avaliação ${icon('arrow')}</button><button class="btn secondary full" style="margin-top:10px" data-go="produto">Voltar ao produto</button></div>`, 'Avaliação enviada', 'clube');
}

function statusPill(r) {
  const approved = r.status === 'approved', rejected = r.status === 'rejected';
  return `<span class="pill ${r.status}">${icon(approved ? 'check' : rejected ? 'close' : 'clock')}${approved ? 'Aprovada' : rejected ? 'Não aprovada' : 'Aguardando análise'}</span>`;
}

async function status() {
  let r = currentId() ? await db.reviews.get(currentId()) : null;
  if (!r || (user && r.userId !== user.id)) r = (await db.reviews.listMine())[0];
  if (!r) return shell(`<div class="content-narrow"><h1>Minhas avaliações</h1><div class="empty">Você ainda não enviou uma avaliação.</div><button class="btn full" style="margin-top:20px" data-go="avaliar">Avaliar produto</button></div>`, 'Minhas avaliações', 'clube');
  const approved = r.status === 'approved', rejected = r.status === 'rejected';
  return shell(`<div class="content-narrow"><div class="status-hero"><div class="status-icon ${approved ? 'approved' : rejected ? 'rejected' : ''}">${icon(approved ? 'check' : rejected ? 'close' : 'clock')}</div><h1>${approved ? 'Sua avaliação foi aprovada' : rejected ? 'Sua avaliação não foi aprovada' : 'Sua avaliação está aguardando análise'}</h1><p>${approved ? `Seu relato foi publicado. Foram creditados ${POINTS_PER_REVIEW} pontos por esta avaliação.` : rejected ? 'A equipe de moderação do Experience Rewards não aprovou este relato. Ele não foi publicado e não gerou pontos.' : `A equipe de moderação do Experience Rewards vai analisar seu relato em até ${MODERATION_SLA}. Você não precisa reenviar nem realizar outra ação.`}</p></div><div style="text-align:center">${statusPill(r)}</div>${rejected && r.moderationNote ? `<div class="notice warning">${icon('info')}<span><strong>Motivo informado pela moderação:</strong> ${e(r.moderationNote)}</span></div>` : ''}<div class="timeline"><div class="timeline-row done"><span class="dot">${icon('check')}</span><div><strong>Avaliação enviada</strong><small>${date(r.createdAt)} · texto e contexto esportivo recebidos.</small></div></div><div class="timeline-row ${approved || rejected ? 'done' : ''}"><span class="dot">${icon(approved ? 'check' : rejected ? 'close' : 'clock')}</span><div><strong>${approved ? 'Avaliação aprovada' : rejected ? 'Avaliação não aprovada' : 'Aguardando análise da equipe de moderação'}</strong><small>${approved ? `${r.moderatedAt ? date(r.moderatedAt) + ' · ' : ''}Seu relato já aparece na página do produto.` : rejected ? 'Relato não publicado.' : `Previsão: até ${MODERATION_SLA}. Seu relato ainda não está público.`}</small></div></div><div class="timeline-row ${approved ? 'done' : ''}"><span class="dot">${icon(approved ? 'check' : rejected ? 'close' : 'clock')}</span><div><strong>${approved ? `+${POINTS_PER_REVIEW} pontos creditados` : rejected ? 'Nenhum ponto creditado' : `${POINTS_PER_REVIEW} pontos previstos após aprovação`}</strong><small>${approved ? 'Crédito único registrado no extrato. Consulte seu saldo no Clube.' : rejected ? 'Avaliações não aprovadas não geram pontos.' : 'Os pontos serão adicionados automaticamente se a avaliação for aprovada.'}</small></div></div></div><article class="own-review"><div class="row"><strong style="font-size:13px">Seu relato</strong><small>${date(r.createdAt)}</small></div><p>${e(r.text)}</p><span class="pill">${e(r.sport)} · ${e(r.level)}</span>${mediaBlock(r)}</article>${rejected ? `<button class="btn full" data-go="avaliar">Enviar nova avaliação ${icon('arrow')}</button>` : ''}<button class="btn ${rejected ? 'secondary' : ''} full" style="margin-top:10px" data-go="minhas">Minhas avaliações ${icon('arrow')}</button><button class="btn secondary full" style="margin-top:10px" data-go="clube">Consultar meus pontos</button></div>`, 'Acompanhar avaliação', 'clube');
}

async function mine() {
  const reviews = await db.reviews.listMine();
  return shell(`<div class="content-narrow"><div class="eyebrow">Sua contribuição</div><h1>Minhas avaliações</h1><p class="intro">Acompanhe os relatos que você compartilhou.</p>${reviews.length ? reviews.map(r => `<article class="own-review"><div class="row"><strong style="font-size:13px">Blusa de Trilha MH100</strong>${statusPill(r)}</div><p>${e(r.text)}</p>${r.mediaType ? `<p class="subtle">${icon(r.mediaType === 'photo' ? 'photo' : 'video')} ${r.mediaType === 'photo' ? 'Foto' : 'Vídeo'} anexado</p>` : ''}<button class="btn outline small" data-go="status" data-id="${e(r.id)}">Acompanhar avaliação ${icon('arrow')}</button></article>`).join('') : '<div class="empty" style="margin:22px 0">Sua próxima experiência pode ajudar alguém a escolher.</div>'}<button class="btn full" data-go="avaliar">Avaliar o produto</button><button class="btn secondary full" style="margin-top:10px" data-go="clube">Ver saldo e benefícios</button></div>`, 'Minhas avaliações', 'clube');
}

async function club() {
  await loadWallet();
  const points = balance();
  const history = cache.ledger.map(l => ({ title: l.reason === 'review_approved' ? 'Avaliação aprovada' : 'Benefício resgatado', detail: l.reason === 'review_approved' ? 'Blusa MH100' : l.description, date: l.createdAt, points: l.points }));
  const balanceCard = user
    ? `<div class="balance-card"><h2>Seu saldo disponível</h2><div class="balance" id="balance">${points} <span>pontos</span></div><p class="subtle">${icon('sparkles')} ${POINTS_PER_REVIEW} pontos por avaliação aprovada. Os pontos usados nos resgates são descontados deste saldo.</p><button class="btn full" data-go="beneficios">Meus benefícios ${icon('arrow')}</button><button class="btn secondary full" style="margin-top:10px" data-go="minhas">Minhas avaliações</button><p class="caption">Pontos demonstrativos, sem valor financeiro.</p></div><h2 style="font-size:18px;margin:25px 0 8px">Extrato de pontos</h2>${history.length ? history.map(c => `<div class="history-row"><span>${icon(c.points > 0 ? 'plus' : 'tag')}</span><div><strong style="font-size:13px">${c.title}</strong><small>${e(c.detail)} · ${date(c.date)}</small></div><span class="points ${c.points < 0 ? 'debit' : ''}">${c.points > 0 ? '+' : ''}${c.points}</span></div>`).join('') : `<div class="empty">Nenhuma movimentação ainda. Você recebe ${POINTS_PER_REVIEW} pontos após a aprovação de cada avaliação.</div>`}`
    : `<div class="balance-card"><h2>Seu saldo</h2><p>Entre na sua conta para ver seus pontos, acompanhar avaliações e resgatar benefícios.</p><button class="btn full" data-go="entrar" data-next="clube">Entrar ou criar conta ${icon('arrow')}</button><p class="caption">Pontos demonstrativos, sem valor financeiro.</p></div>`;
  return shell(`<div class="club-green">Sua prática tem valor. Compartilhe experiências.</div><div class="club-hero"><div class="eyebrow" style="color:#71ffa3">Experience Rewards</div><h1>Experiências que conectam. Pontos que recompensam.</h1><p>Ajude outras pessoas a escolher o próximo equipamento da sua jornada.</p></div><div class="club-cards"><div>${balanceCard}</div><div><div class="eyebrow">Benefícios para sua jornada</div><h2 style="font-size:24px;margin:4px 0 7px">Troque seus pontos</h2><p class="intro" style="margin-bottom:18px">Resgate um benefício por operação. Você pode resgatar novamente enquanto houver saldo suficiente.</p>${benefits.map(b => `<article class="benefit-card"><span class="benefit-icon">${icon(b.icon)}</span><div class="benefit-info"><h3>${b.title}</h3><p>${b.description}</p><strong class="benefit-cost">${b.cost} pontos</strong>${user ? `<small>Seu saldo: ${points} pontos</small>${points < b.cost ? `<small class="points-shortfall">Faltam ${b.cost - points} pontos</small>` : '<small class="points-available">Saldo suficiente para resgatar</small>'}` : ''}</div><button class="btn outline small" data-action="benefit" data-id="${b.id}">Ver detalhes</button></article>`).join('')}<div class="notice">${icon('info')}<span>O resgate desconta pontos do saldo. Os benefícios ficam em Meus benefícios e não expiram. Códigos e ofertas são fictícios, sem uso comercial.</span></div></div></div>`, 'Clube Decathlon', 'clube', { back: false });
}

async function myBenefits() {
  await loadWallet();
  const list = cache.redemptions;
  return shell(`<div class="content-narrow"><div class="eyebrow">Experience Rewards</div><h1>Meus benefícios</h1><p class="intro">Seus resgates ficam aqui. Cada resgate consome pontos uma única vez; consultar ou abrir um benefício já resgatado não gasta mais pontos.</p><div class="notice">${icon('club')}<span>Saldo disponível: <strong>${balance()} pontos</strong>. Benefícios sem vencimento.</span></div>${list.length ? list.map(r => { const b = benefitById(r.benefitId); return `<article class="owned-benefit"><div class="row"><span class="pill approved">${icon('check')} Resgatado</span><small>${date(r.createdAt)}</small></div><h2>${e(r.title)}</h2><p class="subtle">${r.cost} pontos consumidos neste resgate.</p><p>${e(b?.usage || 'Benefício demonstrativo.')}</p>${r.code ? `<label class="field-label" for="code-${e(r.id)}">Código demonstrativo</label><input class="benefit-code" id="code-${e(r.id)}" readonly value="${e(r.code)}"><button class="btn outline full" data-action="copy-benefit" data-id="${e(r.id)}" data-code="${e(r.code)}">Copiar código</button>` : `<button class="btn full" data-go="ofertas" data-id="${e(r.id)}">Ver ofertas antecipadas ${icon('arrow')}</button>`}<p class="caption">Benefício fictício. Sem validade comercial.</p></article>`; }).join('') : '<div class="empty" style="margin:24px 0">Você ainda não resgatou benefícios. Consulte o catálogo no Clube.</div>'}<button class="btn secondary full" data-go="clube">Voltar ao catálogo de benefícios</button></div>`, 'Meus benefícios', 'clube');
}

async function earlyOffers() {
  await loadWallet();
  const grant = cache.redemptions.find(r => r.id === currentId() && r.benefitId === 'antecipado');
  if (!grant) return shell(`<div class="content-narrow"><h1>Acesso antecipado</h1><div class="notice">${icon('info')} Resgate o acesso antecipado por ${benefitById('antecipado').cost} pontos no Clube para abrir esta seleção.</div><button class="btn full" data-go="clube">Ver benefícios</button></div>`, 'Acesso antecipado', 'clube');
  return shell(`<section class="section"><div class="eyebrow">Benefício resgatado</div><h1>Sua prévia de ofertas</h1><p class="intro">Seleção ilustrativa de uma próxima campanha. Abrir esta página não consome novos pontos.</p><div class="notice">${icon('info')} Produtos, preços e acesso antecipado são demonstrativos. Não há oferta comercial nem compra real.</div><div class="catalog-grid">${products.map(p => `<article class="product-card"><img src="${p.image}" alt="${e(p.name)}"><div class="product-name">${e(p.name)}</div><div class="product-price">R$ ${p.price}</div><span class="pill demo">Prévia ilustrativa</span></article>`).join('')}</div><button class="btn secondary" style="margin-top:24px" data-go="beneficios">Voltar a Meus benefícios</button></section>`, 'Ofertas antecipadas', 'clube');
}

function catalog(tab = 'explorar') {
  return shell(`<section class="section" style="border-top:0"><div class="section-head"><div><div class="eyebrow">Sua próxima aventura</div><h2>${tab === 'descontos' ? 'Ofertas de demonstração' : 'Essenciais para a trilha'}</h2><p class="intro">Catálogo ilustrativo · ${products.length} produtos</p></div></div><div class="catalog-grid">${products.map((p, i) => `<button class="product-card" data-action="open-product" data-product="${p.id}">${i === 0 ? '<span class="tag-sale">Melhor custo-benefício</span>' : ''}<img src="${p.image}" alt="${e(p.name)}"><div class="product-name">${p.name}</div><div class="product-price">R$ ${p.price}</div></button>`).join('')}</div><div class="notice">${icon('info')} As avaliações do Experience Rewards estão disponíveis na blusa fleece masculina MH100.</div></section>`, tab === 'descontos' ? 'Descontos' : 'Explorar', tab, { back: false });
}

function home() {
  return shell(`<div class="content-narrow mobile-only" style="padding-bottom:0"><form class="searchbox" data-search>${icon('search')}<input aria-label="Buscar produtos" placeholder="Busque por 'blusa de trilha'"><button class="iconbtn" aria-label="Pesquisar">${icon('arrow')}</button></form></div><div class="home-hero"><img src="${asset('summer.webp')}" alt="Pessoas praticando esporte ao ar livre"><div><div class="eyebrow">Experience Rewards</div><h1>O esporte fica melhor quando a gente compartilha.</h1><p>Encontre experiências de pessoas com uma rotina parecida com a sua.</p><button class="btn" data-go="produto">Conhecer a blusa de trilha ${icon('arrow')}</button></div></div><section class="section"><div class="section-head"><h2>Essenciais para sua rotina</h2><button class="rating-link" data-go="explorar">Ver todos</button></div><div class="catalog-grid">${products.map(p => `<button class="product-card" data-action="open-product" data-product="${p.id}"><img src="${p.image}" alt="${e(p.name)}"><div class="product-name">${p.name}</div><div class="product-price">R$ ${p.price}</div></button>`).join('')}</div></section>`, 'Início', 'home', { back: false });
}

function readCart() { try { return JSON.parse(localStorage.getItem('der-cart') || '[]'); } catch { return []; } }
function writeCart(v) { try { localStorage.setItem('der-cart', JSON.stringify(v)); } catch { /* ignore */ } }
function cart() {
  const items = readCart();
  return shell(`<div class="content-narrow"><h1>Seu carrinho</h1>${items.length ? `<div class="cart-item"><img src="${asset('fleece-front.webp')}" alt="Blusa fleece"><div><strong>Blusa Fleece MH100 Quechua Preta</strong><div class="subtle">Tamanho ${e(items[0].size)} · 1 unidade</div><strong>R$ 149,99</strong></div></div><button class="btn secondary full" data-action="clear-cart" style="margin-top:18px">Remover produto</button>` : '<div class="empty" style="margin-top:22px">Nenhum produto adicionado.</div>'}<div class="notice">${icon('info')} Carrinho demonstrativo: não há checkout ou compra real.</div><button class="btn full" data-go="produto">Voltar ao produto</button></div>`, 'Carrinho', 'carrinho');
}

function authPage() {
  const mode = params().get('modo') === 'cadastro' ? 'cadastro' : 'entrar';
  const signup = mode === 'cadastro';
  return shell(`<div class="content-narrow auth-box"><div class="eyebrow">Experience Rewards</div><h1>${signup ? 'Crie sua conta' : 'Entre na sua conta'}</h1><p class="intro">${signup ? 'Com uma conta, você envia avaliações, acompanha a moderação e acumula pontos.' : 'Acompanhe suas avaliações, seu saldo e seus benefícios.'}</p><div class="auth-tabs" role="tablist"><button role="tab" aria-selected="${!signup}" class="${!signup ? 'active' : ''}" data-action="auth-mode" data-mode="entrar">Entrar</button><button role="tab" aria-selected="${signup}" class="${signup ? 'active' : ''}" data-action="auth-mode" data-mode="cadastro">Criar conta</button></div><form id="auth-form" data-mode="${mode}" novalidate>${signup ? `<div class="field"><label for="first-name">Primeiro nome</label><input id="first-name" name="firstName" autocomplete="given-name" maxlength="40" required><small>É o único dado pessoal exibido junto das suas avaliações.</small></div>` : ''}<div class="field"><label for="email">E-mail</label><input id="email" name="email" type="email" autocomplete="email" required></div><div class="field"><label for="password">Senha</label><input id="password" name="password" type="password" minlength="8" autocomplete="${signup ? 'new-password' : 'current-password'}" required>${signup ? '<small>Mínimo de 8 caracteres.</small>' : ''}</div>${signup ? `<div class="check-row"><input id="privacy-consent" type="checkbox" required><label for="privacy-consent">Li e concordo com o uso do meu primeiro nome e do meu perfil esportivo para exibir minhas avaliações, conforme a <a href="?screen=privacidade" target="_blank" rel="noopener">política de privacidade</a>.</label></div>` : ''}<p id="auth-error" class="field-error" role="alert"></p><button class="btn full" type="submit">${signup ? 'Criar conta' : 'Entrar'} ${icon('arrow')}</button></form>${!signup ? `<button class="rating-link forgot" data-go="recuperar">Esqueci minha senha</button>` : ''}${db.mode === 'local' ? `<div class="notice">${icon('info')}<span>Modo local: as contas ficam salvas somente neste navegador. Conecte o Supabase para contas reais.</span></div>` : ''}</div>`, signup ? 'Criar conta' : 'Entrar', 'clube');
}

function recoverPage() {
  return shell(`<div class="content-narrow auth-box"><h1>Recuperar senha</h1>${db.mode === 'local' ? `<div class="notice warning">${icon('info')}<span>No modo local não há envio de e-mail. Crie uma nova conta neste navegador ou conecte o Supabase.</span></div>` : `<p class="intro">Informe seu e-mail. Enviaremos um link para você criar uma nova senha.</p><form id="recover-form" novalidate><div class="field"><label for="email">E-mail</label><input id="email" type="email" autocomplete="email" required></div><p id="auth-error" class="field-error" role="alert"></p><button class="btn full" type="submit">Enviar link</button></form>`}<button class="btn secondary full" style="margin-top:12px" data-go="entrar">Voltar para entrar</button></div>`, 'Recuperar senha', 'clube');
}

function newPasswordPage() {
  return shell(`<div class="content-narrow auth-box"><h1>Crie uma nova senha</h1><form id="newpass-form" novalidate><div class="field"><label for="password">Nova senha</label><input id="password" type="password" minlength="8" autocomplete="new-password" required><small>Mínimo de 8 caracteres.</small></div><p id="auth-error" class="field-error" role="alert"></p><button class="btn full" type="submit">Salvar nova senha</button></form></div>`, 'Nova senha', 'clube');
}

async function account() {
  await loadWallet();
  return shell(`<div class="content-narrow"><div class="profile-hero"><div class="avatar" style="background:${avatarColor(user.firstName + user.id)}">${e(initials(user.firstName))}</div><h1>Olá, ${e(user.firstName)}</h1><span class="pill demo">${e(user.email)}</span></div><dl class="redemption-summary"><div><dt>Saldo disponível</dt><dd>${balance()} pontos</dd></div><div><dt>Benefícios resgatados</dt><dd>${cache.redemptions.length}</dd></div></dl><button class="btn full" data-go="minhas">Minhas avaliações ${icon('arrow')}</button><button class="btn secondary full" style="margin-top:10px" data-go="beneficios">Meus benefícios</button><button class="btn secondary full" style="margin-top:10px" data-go="clube">Clube e extrato de pontos</button>${user.role === 'admin' ? `<a class="btn outline full" style="margin-top:10px" href="${import.meta.env.BASE_URL}admin.html">${icon('shield')} Painel de moderação</a>` : ''}<button class="btn danger full" style="margin-top:22px" data-action="logout">${icon('logout')} Sair da conta</button><p class="caption" style="text-align:center">Versão ${APP_VERSION} · ${db.mode === 'supabase' ? 'dados no Supabase' : 'banco local simulado neste navegador'}</p></div>`, 'Minha conta', 'clube');
}

function privacy() {
  return shell(`<div class="content-narrow"><div class="eyebrow">LGPD · Privacy by Design</div><h1>Privacidade e dados</h1><p class="intro">Como o Experience Rewards trata as suas informações.</p><h2 style="font-size:18px">O que coletamos</h2><ul class="plain-list"><li><strong>E-mail e senha</strong>, apenas para autenticação. O e-mail nunca é exibido publicamente.</li><li><strong>Primeiro nome</strong>, exibido junto das suas avaliações aprovadas.</li><li><strong>Perfil esportivo</strong> (modalidade, nível e frequência) informado em cada avaliação.</li><li><strong>Texto e mídia</strong> que você enviar, publicados somente após moderação e com o seu consentimento.</li></ul><h2 style="font-size:18px">O que não coletamos</h2><p>CPF, endereço, dados de pagamento ou qualquer documento.</p><h2 style="font-size:18px">Moderação</h2><p>Todo conteúdo passa por moderação humana antes de ser publicado, com apoio de uma pré-análise automática que sinaliza possíveis dados pessoais ou linguagem imprópria.</p><h2 style="font-size:18px">Segurança</h2><p>O acesso aos dados é controlado no banco por políticas de segurança por linha: cada pessoa só vê o próprio extrato, resgates e avaliações pendentes. Fotos e vídeos ficam em armazenamento privado e só são exibidos publicamente após aprovação.</p><h2 style="font-size:18px">Seus direitos</h2><p>Para corrigir ou excluir seus dados, entre em contato com o grupo responsável pelo projeto acadêmico.</p><div class="notice">${icon('info')} Projeto acadêmico FIAP Pós-Tech, sem vínculo comercial com a Decathlon.</div><button class="btn secondary full" data-go="produto">Voltar</button></div>`, 'Privacidade', 'explorar');
}

function missing() { return shell(`<div class="content-narrow"><h1>Conteúdo não encontrado</h1><button class="btn" data-go="produto">Voltar ao produto</button></div>`, 'Experience Rewards'); }
function errorPage(err) { return shell(`<div class="content-narrow"><div class="status-hero"><div class="status-icon rejected">${icon('close')}</div><h1>Não foi possível carregar</h1><p>${e(friendlyError(err))}</p></div><button class="btn full" data-action="retry">Tentar novamente</button></div>`, 'Experience Rewards'); }

const pages = { produto: product, avaliacoes: allReviews, perfil: profile, avaliar: form, enviada: sent, status, minhas: mine, clube: club, beneficios: myBenefits, ofertas: earlyOffers, home, explorar: () => catalog('explorar'), descontos: () => catalog('descontos'), carrinho: cart, entrar: authPage, recuperar: recoverPage, 'nova-senha': newPasswordPage, conta: account, privacidade: privacy };

async function render() {
  const seq = ++renderSeq;
  let s = screen();
  if (AUTH_SCREENS.includes(s) && !user) {
    const u = new URL(location.href); const id = currentId();
    u.search = ''; u.searchParams.set('screen', 'entrar'); u.searchParams.set('next', s); if (id) u.searchParams.set('nextId', id);
    history.replaceState({}, '', u.pathname + u.search); s = 'entrar';
  }
  if (s === 'entrar' && user) { goAfterLogin(); return; }
  let html;
  try { html = await (pages[s] || product)(); } catch (err) { console.error(err); html = errorPage(err); }
  if (seq !== renderSeq) return;
  document.title = 'Experience Rewards — Decathlon';
  app.innerHTML = html;
  bindForms();
}

// ---------------------------------------------------------------- modais
function openModal(html, cls = '') {
  modalFocus = document.activeElement;
  modalRoot.innerHTML = `<div class="modal-overlay"><div class="modal ${cls}" role="dialog" aria-modal="true" aria-labelledby="modal-heading" tabindex="-1">${html}</div></div>`;
  const title = modalRoot.querySelector('h2'); if (title) title.id = 'modal-heading';
  document.body.style.overflow = 'hidden';
  setTimeout(() => modalRoot.querySelector('input,button,textarea,.modal')?.focus(), 0);
}
function closeModal(restore = true) { modalRoot.innerHTML = ''; document.body.style.overflow = ''; if (restore && modalFocus?.isConnected) modalFocus.focus(); }

async function benefitModal(id, message = '') {
  const b = benefitById(id); if (!b) return;
  if (user) await loadWallet();
  const points = balance(), enough = points >= b.cost, operationId = uuid();
  const action = !user
    ? `<button class="btn full" data-go="entrar" data-next="clube">Entrar para resgatar ${icon('arrow')}</button>`
    : `<button class="btn full" data-action="confirm-benefit" data-id="${id}" data-operation="${operationId}" ${enough ? '' : 'disabled aria-describedby="insufficient-points"'}>Resgatar por ${b.cost} pontos</button>`;
  openModal(`<button class="iconbtn close" data-action="close-modal" aria-label="Fechar detalhes do benefício">${icon('close')}</button><div class="benefit-icon">${icon(b.icon)}</div><span class="pill demo" style="margin-top:12px">Benefício demonstrativo</span><h2>${b.title}</h2><p>${b.description}</p>${message ? `<div class="notice warning" role="alert">${e(message)}</div>` : ''}${user ? `<dl class="redemption-summary"><div><dt>Seu saldo disponível</dt><dd>${points} pontos</dd></div><div><dt>Custo deste benefício</dt><dd>${b.cost} pontos</dd></div><div class="summary-total"><dt>Saldo após o resgate</dt><dd>${enough ? `${points - b.cost} pontos` : 'Resgate indisponível'}</dd></div></dl>` : `<dl class="redemption-summary"><div><dt>Custo deste benefício</dt><dd>${b.cost} pontos</dd></div></dl>`}<h3>Como usar depois</h3><p>${e(b.usage)}</p><p class="subtle">Sem vencimento. Um benefício por operação; novos resgates são permitidos enquanto houver saldo. Os pontos são descontados ao confirmar.</p>${user && !enough ? `<div class="notice warning" id="insufficient-points">${icon('info')}<span>Faltam <strong>${b.cost - points} pontos</strong>. Cada nova avaliação aprovada gera ${POINTS_PER_REVIEW} pontos.</span></div>` : ''}${action}<button class="btn secondary full" data-action="close-modal">Voltar sem gastar pontos</button>`);
}

async function confirmBenefit(button) {
  button.disabled = true; button.textContent = 'Processando…';
  let result;
  try { result = await db.redemptions.redeem(button.dataset.id, button.dataset.operation); }
  catch (err) { console.error(err); button.disabled = false; button.textContent = 'Tentar novamente'; toast(friendlyError(err)); return; }
  if (!result.ok) { benefitModal(button.dataset.id, result.reason === 'insufficient-points' ? 'Seu saldo mudou. Confira o saldo atualizado antes de resgatar.' : 'Não foi possível concluir. Abra os detalhes e tente novamente.'); return; }
  const r = result.redemption;
  await render();
  openModal(`<div class="status-icon approved">${icon('check')}</div><h2>Resgate concluído!</h2><p>Você resgatou <strong>${e(r.title)}</strong>.</p><dl class="redemption-summary"><div><dt>Pontos consumidos</dt><dd>${r.cost} pontos</dd></div><div class="summary-total"><dt>Seu saldo agora</dt><dd>${result.balance} pontos</dd></div></dl><p>O benefício está salvo em <strong>Meus benefícios</strong>, junto com as instruções para usar. Ele não expira.</p><p class="caption">Resgate demonstrativo, sem validade comercial.</p><button class="btn full" data-go="beneficios">Ver meus benefícios ${icon('arrow')}</button><button class="btn secondary full" data-action="close-modal">Voltar ao catálogo</button>`, 'center');
}

// ---------------------------------------------------------------- formulários
function clearFormFile() { if (formPreviewUrl) URL.revokeObjectURL(formPreviewUrl); formFile = null; formPreviewUrl = null; }

function showMedia() {
  const box = document.querySelector('#media-selected'); if (!box) return;
  const wrap = document.querySelector('#media-consent-wrap');
  wrap.hidden = !formFile;
  if (!formFile) { box.innerHTML = ''; document.querySelector('#media-consent').checked = false; return; }
  const kind = mediaKind(formFile);
  box.innerHTML = `<div class="media-chosen">${kind === 'photo' ? `<img src="${formPreviewUrl}" alt="Pré-visualização da foto escolhida">` : `<video src="${formPreviewUrl}" muted playsinline preload="metadata" aria-label="Pré-visualização do vídeo escolhido"></video>`}<div><strong>${e(formFile.name)}</strong><small>${MEDIA_RULES[kind].label} · ${formatBytes(formFile.size)}</small></div><button type="button" class="btn secondary small" data-action="remove-media">Remover</button></div>`;
}

function setFieldError(id, errId, message) {
  const field = document.getElementById(id), err = document.getElementById(errId);
  field?.setAttribute('aria-invalid', String(!!message));
  if (err) { if (message) err.textContent = message; err.classList.toggle('show', !!message); }
  return !!message;
}

function bindForms() {
  const f = document.querySelector('#review-form');
  if (f) {
    const text = f.querySelector('#review-text');
    text.addEventListener('input', () => {
      const n = text.value.trim().length;
      const counter = document.querySelector('#char-count');
      counter.textContent = n < REVIEW_MIN ? `${n} caracteres (faltam ${REVIEW_MIN - n})` : `${n} caracteres ✓`;
      counter.classList.toggle('count-ok', n >= REVIEW_MIN);
      if (n >= REVIEW_MIN && !personalDataFlags(text.value).length) setFieldError('review-text', 'text-error', '');
    });
    f.querySelectorAll('select').forEach(sel => sel.addEventListener('change', () => { if (sel.value) setFieldError(sel.id, `${sel.id}-error`, ''); }));
    f.querySelector('#profile-consent').addEventListener('change', ev => { if (ev.target.checked) setFieldError('profile-consent', 'consent-error', ''); });
    f.querySelector('#media-consent').addEventListener('change', ev => { if (ev.target.checked) setFieldError('media-consent', 'media-consent-error', ''); });
    f.querySelector('#media-file').addEventListener('change', ev => {
      const file = ev.target.files?.[0]; ev.target.value = '';
      setFieldError('media-file', 'media-error', '');
      if (!file) return;
      const kind = mediaKind(file);
      if (!kind) { setFieldError('media-file', 'media-error', 'Formato não suportado. Use JPG, PNG, WEBP, HEIC, MP4, MOV ou WEBM.'); return; }
      if (file.size > MEDIA_RULES[kind].maxBytes) { setFieldError('media-file', 'media-error', `${MEDIA_RULES[kind].label} muito grande. O limite é ${formatBytes(MEDIA_RULES[kind].maxBytes)}.`); return; }
      clearFormFile(); formFile = file; formPreviewUrl = URL.createObjectURL(file); showMedia();
    });
    f.addEventListener('submit', async ev => {
      ev.preventDefault();
      if (submitting) return;
      const value = text.value.trim();
      const pii = personalDataFlags(value);
      const errors = [
        setFieldError('review-text', 'text-error', !value ? 'Conte sua experiência antes de enviar.' : value.length < REVIEW_MIN ? `Conte um pouco mais: mínimo de ${REVIEW_MIN} caracteres.` : pii.length ? `Remova dados pessoais do relato (${pii.map(p => p.label.replace('Possível ', '').toLowerCase()).join(', ')}).` : '') && 'review-text',
        ...['sport', 'level', 'frequency'].map(id => setFieldError(id, `${id}-error`, document.getElementById(id).value ? '' : document.querySelector(`#${id}-error`).textContent) && id),
        formFile && setFieldError('media-consent', 'media-consent-error', document.querySelector('#media-consent').checked ? '' : 'Para enviar a mídia, autorize a exibição pública ou remova o arquivo.') && 'media-consent',
        setFieldError('profile-consent', 'consent-error', document.querySelector('#profile-consent').checked ? '' : 'Confirme que entendeu como o perfil será exibido.') && 'profile-consent'
      ].filter(Boolean);
      if (errors.length) { const first = document.getElementById(errors[0]); first.focus(); first.scrollIntoView({ block: 'center' }); const names = { 'review-text': 'o texto da experiência', sport: 'o esporte', level: 'o nível', frequency: 'a frequência', 'media-consent': 'a autorização da foto/vídeo', 'profile-consent': 'a confirmação no final do formulário' }; toast(`Falta preencher: ${errors.map(x => names[x]).join(', ')}.`); return; }
      const btn = f.querySelector('#submit-review');
      submitting = true; btn.disabled = true; btn.textContent = formFile ? 'Enviando arquivo…' : 'Enviando…';
      try {
        const review = await db.reviews.create({ productId: PRODUCT_ID, text: value, sport: f.sport.value, level: f.level.value, frequency: f.frequency.value, mediaFile: formFile, mediaKind: mediaKind(formFile), mediaConsent: !!formFile && document.querySelector('#media-consent').checked });
        clearFormFile();
        toast('Sua avaliação foi enviada para moderação.');
        nav('enviada', review.id);
      } catch (err) {
        console.error(err); toast(friendlyError(err));
        btn.disabled = false; btn.innerHTML = `Enviar minha experiência ${icon('arrow')}`;
      } finally { submitting = false; }
    });
  }

  const auth = document.querySelector('#auth-form');
  if (auth) auth.addEventListener('submit', async ev => {
    ev.preventDefault();
    const signup = auth.dataset.mode === 'cadastro';
    const email = auth.email.value.trim(), password = auth.password.value, firstName = auth.firstName?.value.trim();
    const err = msg => setFieldError('email', 'auth-error', msg);
    if (signup && !firstName) return err('Informe seu primeiro nome.');
    if (!/^\S+@\S+\.\S+$/.test(email)) return err('Informe um e-mail válido.');
    if (password.length < 8) return err('A senha precisa ter pelo menos 8 caracteres.');
    if (signup && !document.querySelector('#privacy-consent').checked) return err('Para criar a conta, aceite o uso dos dados descrito acima.');
    err('');
    const btn = auth.querySelector('button[type=submit]'); btn.disabled = true;
    try {
      if (signup) {
        const res = await db.auth.signUp({ email, password, firstName });
        if (res.needsConfirmation) {
          app.querySelector('#conteudo').innerHTML = `<div class="content-narrow"><div class="status-hero"><div class="status-icon approved">${icon('check')}</div><h1>Confirme seu e-mail</h1><p>Enviamos um link para <strong>${e(email)}</strong>. Abra o e-mail e clique no link para ativar sua conta.</p></div><button class="btn full" data-go="entrar">Já confirmei, quero entrar</button></div>`;
          return;
        }
        user = res.user;
        toast(`Conta criada. Boas-vindas, ${user.firstName}!`);
      } else {
        user = await db.auth.signIn({ email, password });
        toast(`Olá, ${user.firstName}!`);
      }
      knownCredits = null; goAfterLogin();
    } catch (e2) { err(friendlyError(e2)); btn.disabled = false; }
  });

  const recover = document.querySelector('#recover-form');
  if (recover) recover.addEventListener('submit', async ev => {
    ev.preventDefault();
    const email = recover.querySelector('#email').value.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) return setFieldError('email', 'auth-error', 'Informe um e-mail válido.');
    try { await db.auth.resetPassword(email); recover.outerHTML = `<div class="notice green">${icon('check')}<span>Se houver uma conta com este e-mail, você receberá um link para criar uma nova senha.</span></div>`; }
    catch (err) { setFieldError('email', 'auth-error', friendlyError(err)); }
  });

  const np = document.querySelector('#newpass-form');
  if (np) np.addEventListener('submit', async ev => {
    ev.preventDefault();
    const pw = np.querySelector('#password').value;
    if (pw.length < 8) return setFieldError('password', 'auth-error', 'A senha precisa ter pelo menos 8 caracteres.');
    try { await db.auth.updatePassword(pw); toast('Senha atualizada.'); nav('conta', null, { replace: true }); }
    catch (err) { setFieldError('password', 'auth-error', friendlyError(err)); }
  });
}

// ---------------------------------------------------------------- eventos
document.addEventListener('click', async ev => {
  const b = ev.target.closest('button'); if (!b) return;
  if (b.dataset.go) { nav(b.dataset.go, b.dataset.id, { next: b.dataset.next }); return; }
  if (b.dataset.filter) { const u = new URL(location.href); u.searchParams.set('filter', b.dataset.filter); history.replaceState({}, '', u.pathname + u.search); render(); return; }
  if (b.dataset.photo) { document.querySelector('#main-photo').src = asset(`${b.dataset.photo}.webp`); document.querySelectorAll('[data-photo]').forEach(x => x.classList.toggle('selected', x === b)); return; }
  if (b.dataset.size) { document.querySelector('#size-label').textContent = b.dataset.size; document.querySelectorAll('[data-size]').forEach(x => { x.classList.toggle('selected', x === b); x.setAttribute('aria-pressed', String(x === b)); }); return; }
  const a = b.dataset.action;
  if (a === 'back') { const s = screen(); const fallback = ['avaliacoes', 'avaliar', 'perfil', 'privacidade'].includes(s) ? 'produto' : s === 'ofertas' ? 'beneficios' : ['enviada', 'status'].includes(s) ? 'minhas' : ['beneficios', 'minhas', 'conta', 'entrar', 'recuperar'].includes(s) ? 'clube' : 'home'; nav(fallback); }
  if (a === 'write-review') nav('avaliar');
  if (a === 'open-product') { if (b.dataset.product !== 'fleece') toast('As avaliações estão disponíveis na blusa fleece MH100. Abrindo esse produto.'); nav('produto'); }
  if (a === 'cart') { writeCart([{ size: document.querySelector('#size-label').textContent }]); toast('Produto adicionado ao carrinho.'); }
  if (a === 'clear-cart') { writeCart([]); render(); }
  if (a === 'gallery') openModal(`<button class="iconbtn close" data-action="close-modal" aria-label="Fechar fotos">${icon('close')}</button><h2>Fotos do catálogo</h2>${['fleece-main', 'fleece-front', 'fleece-back'].map(x => `<img src="${asset(x + '.webp')}" alt="Vista da blusa MH100" style="width:100%;border-radius:10px;margin-bottom:10px">`).join('')}`);
  if (a === 'close-modal') closeModal();
  if (a === 'benefit') benefitModal(b.dataset.id);
  if (a === 'confirm-benefit') confirmBenefit(b);
  if (a === 'remove-media') { clearFormFile(); showMedia(); document.querySelector('.media-drop')?.focus(); }
  if (a === 'auth-mode') { const u = new URL(location.href); u.searchParams.set('modo', b.dataset.mode); history.replaceState({}, '', u.pathname + u.search); render(); }
  if (a === 'logout') { await db.auth.signOut(); user = null; knownCredits = null; toast('Você saiu da sua conta.'); nav('produto'); }
  if (a === 'retry') render();
  if (a === 'copy-benefit') { const code = b.dataset.code; navigator.clipboard?.writeText(code).then(() => toast('Código copiado.')).catch(() => { document.getElementById(`code-${b.dataset.id}`)?.select(); toast('Selecione e copie o código.'); }); }
});
document.addEventListener('submit', ev => { if (ev.target.matches('[data-search]')) { ev.preventDefault(); nav('explorar'); } });
document.addEventListener('keydown', ev => {
  if (!modalRoot.firstChild) return;
  const modal = modalRoot.querySelector('.modal');
  if (ev.key === 'Escape') { closeModal(); return; }
  if (ev.key === 'Tab') { const els = [...modal.querySelectorAll('button,input,select,textarea,a[href]')].filter(el => !el.disabled); const first = els[0], last = els.at(-1); if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last?.focus(); } else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first?.focus(); } }
});
window.addEventListener('popstate', () => render());

// Atualização em tempo real (Supabase Realtime ou outra aba no modo local).
db.subscribe(async () => {
  if (user) await loadWallet().catch(() => {});
  if (!FORM_SCREENS.includes(screen()) && !modalRoot.firstChild) render();
});

db.auth.onChange(async event => {
  const before = user?.id;
  user = await db.auth.getUser();
  if (event === 'PASSWORD_RECOVERY') { nav('nova-senha', null, { replace: true }); return; }
  if (before !== user?.id && !FORM_SCREENS.includes(screen())) { knownCredits = null; if (user) await loadWallet().catch(() => {}); render(); }
});

// ---------------------------------------------------------------- início
user = await db.auth.getUser().catch(() => null);
if (user) await loadWallet().catch(() => {});
render();