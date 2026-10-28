// Dados de catálogo estáticos (produtos e benefícios demonstrativos) e regras de negócio compartilhadas.
export const POINTS_PER_REVIEW = 50;
export const MODERATION_SLA = '2 dias úteis';

export const SPORTS = ['Trilha', 'Corrida', 'Caminhada', 'Ciclismo', 'Camping', 'Outro'];
export const LEVELS = ['Iniciante', 'Intermediário', 'Avançado'];
export const FREQUENCIES = ['Menos de 1 vez por semana', '1 vez por semana', '2–3 vezes por semana', '4 ou mais vezes por semana'];

export const REVIEW_MIN = 20;
export const REVIEW_MAX = 1000;

export const MEDIA_RULES = {
  photo: { label: 'Foto', maxBytes: 5 * 1024 * 1024, types: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'] },
  video: { label: 'Vídeo', maxBytes: 50 * 1024 * 1024, types: ['video/mp4', 'video/quicktime', 'video/webm'] }
};

export function mediaKind(file) {
  if (!file) return null;
  if (MEDIA_RULES.photo.types.includes(file.type)) return 'photo';
  if (MEDIA_RULES.video.types.includes(file.type)) return 'video';
  return null;
}

const asset = (name) => `${import.meta.env.BASE_URL}assets/${name}`;
export { asset };

export const products = [
  { id: 'fleece', name: 'Blusa Fleece Masculina de Trilha Térmica MH100 Quechua Preta', short: 'Blusa de Trilha MH100', brand: 'QUECHUA', image: asset('fleece-main.webp'), price: '149,99' },
  { id: 'women', name: 'Blusa Fleece Feminina de Trilha Térmica MH100 Quechua Preta', short: 'Fleece feminino MH100', brand: 'QUECHUA', image: asset('fleece-women.webp'), price: '149,99' },
  { id: 'boot', name: 'Bota Impermeável Feminina de Trilha MH100 Quechua Azul', short: 'Bota de trilha MH100', brand: 'QUECHUA', image: asset('boot.webp'), price: '429,99' }
];

export function productById(id) { return products.find(p => p.id === id) || products[0]; }

export const benefits = [
  { id: 'desconto', title: '5% na sua próxima compra', description: 'Um cupom demonstrativo de desconto para equipamentos.', cost: 50, tag: 'Desconto', icon: 'tag', usage: 'Na compra, o código seria informado no campo de cupom para obter 5% de desconto. Consulte e copie o código em Meus benefícios. Por ser um projeto acadêmico, ele não funciona em lojas ou sites reais.' },
  { id: 'frete', title: 'Frete grátis', description: 'Um cupom demonstrativo para a entrega da sua próxima compra.', cost: 100, tag: 'Entrega', icon: 'truck', usage: 'Na compra, o código seria aplicado no campo de cupom para obter frete grátis. Consulte e copie o código em Meus benefícios. Não há envio real de produtos.' },
  { id: 'antecipado', title: 'Acesso antecipado', description: 'Abra uma seleção ilustrativa de ofertas antes da próxima campanha.', cost: 150, tag: 'Clube', icon: 'sparkles', usage: 'Depois do resgate, abra Meus benefícios e escolha Ver ofertas antecipadas. A seleção é ilustrativa e não representa uma campanha comercial real.' }
];

export function benefitById(id) { return benefits.find(b => b.id === id); }
