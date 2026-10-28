// Pré-análise automática de conteúdo (regras determinísticas).
// Apoia a moderação humana sinalizando possíveis dados pessoais ou linguagem imprópria.
// A decisão final é sempre de uma pessoa moderadora.

const RULES = [
  { id: 'email', level: 'block', label: 'Possível e-mail', re: /[\w.+-]+@[\w-]+\.[\w.-]+/i },
  { id: 'phone', level: 'block', label: 'Possível telefone', re: /(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?9?\d{4}[-.\s]?\d{4}\b/ },
  { id: 'cpf', level: 'block', label: 'Possível CPF', re: /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/ },
  { id: 'url', level: 'warn', label: 'Link externo', re: /\b(?:https?:\/\/|www\.)\S+/i },
  { id: 'social', level: 'warn', label: 'Menção a perfil de rede social', re: /(?:^|\s)@[a-z0-9_.]{3,}/i },
  { id: 'offensive', level: 'warn', label: 'Linguagem possivelmente ofensiva', re: /\b(idiota|imbecil|ot[aá]rio|babaca|merda|porra|caralho|fdp|lix[oa] de empresa)\b/i },
  { id: 'caps', level: 'warn', label: 'Texto majoritariamente em maiúsculas', test: t => { const l = t.replace(/[^a-zà-ú]/gi, ''); return l.length > 30 && l.replace(/[^A-ZÀ-Ú]/g, '').length / l.length > 0.7; } },
  { id: 'repeat', level: 'warn', label: 'Caracteres repetidos em excesso', re: /(.)\1{6,}/ }
];

export function precheck(text = '') {
  const t = String(text);
  return RULES.filter(r => (r.re ? r.re.test(t) : r.test(t))).map(({ id, level, label }) => ({ id, level, label }));
}

export function personalDataFlags(text) {
  return precheck(text).filter(f => f.level === 'block');
}
