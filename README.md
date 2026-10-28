# Decathlon Experience Rewards — versão de produção 2.0

Projeto acadêmico FIAP Pós-Tech (Tech Challenge Fase 3). Esta versão substitui o protótipo navegável v1.1 por uma aplicação pronta para publicar, com o mesmo visual.

## O que mudou em relação ao protótipo

| Protótipo v1.1 | Produção 2.0 |
|---|---|
| Sem login | Cadastro e login com e-mail e senha (Supabase Auth), recuperação de senha |
| Dados só no navegador | Banco Supabase (Postgres) **ou** banco local simulado, com a mesma API |
| Foto/vídeo simulados | Upload real (Supabase Storage privado; IndexedDB no modo local) |
| Painel com código `FIAP2026` | Painel `admin.html` liberado só para contas com papel de moderação |
| Crédito de pontos no navegador | Crédito e resgate feitos no banco, de forma atômica e sem duplicidade |
| Modo pesquisa (tarefas T1–T4) | Removido |

Regras mantidas: **50 pontos por avaliação aprovada**, resgates de 50 / 100 / 150 pontos, moderação em até 2 dias úteis, badge de ambiente acadêmico no topo.

Novidades de produção: pré-análise automática de conteúdo (bloqueia e-mail, telefone e CPF no relato; sinaliza links e linguagem imprópria para a moderação), motivo de rejeição visível para quem avaliou, atualização em tempo real do saldo após aprovação, página de privacidade (LGPD), consentimento para exibição pública de mídia.

## Estrutura

```
index.html            app (cliente)
admin.html            painel de moderação
src/app.js            telas do app
src/admin.js          painel de moderação
src/data/             camada de dados: supabase.js e local.js (mesma API)
src/lib/              catálogo, regras, pré-análise, utilitários
public/assets/        imagens
supabase/migrations/  SQL completo do banco (tabelas, RLS, funções, storage, exemplos)
```

## Rodar no computador

Precisa do Node.js 18 ou superior.

```bash
npm install
npm run dev
```

Abra o endereço que aparecer (ex.: `http://localhost:5173`). Sem configurar nada, o app roda no **banco local simulado**:

- Crie uma conta normalmente pelo app.
- Painel de moderação: `http://localhost:5173/admin.html`
  - E-mail: `moderacao@experience.demo`
  - Senha: `Moderacao@2026`
- Deixe o app e o painel em duas abas para ver o saldo atualizar sozinho após a aprovação.

## Conectar o Supabase (passo a passo)

1. Crie uma conta em supabase.com e clique em **New project**. Guarde a senha do banco.
2. No projeto, abra **SQL Editor → New query**, cole todo o conteúdo de `supabase/migrations/001_experience_rewards.sql` e clique em **Run**.
3. Abra **Project Settings → API** e copie a **Project URL** e a chave **anon public**.
4. Na pasta do projeto, copie `.env.example` para `.env.local` e preencha:
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   ```
5. Rode `npm run dev` de novo. O rodapé da tela **Minha conta** mostra "dados no Supabase".
6. Em **Authentication → URL Configuration**, coloque o endereço do site em **Site URL** (e em **Redirect URLs** os endereços de teste, ex.: `http://localhost:5173/**`).
7. Cadastre no app a conta que vai moderar e rode no SQL Editor:
   ```sql
   update public.profiles set role = 'admin'
    where id = (select id from auth.users where email = 'seu-email@exemplo.com');
   ```

Observação: por padrão o Supabase pede confirmação de e-mail no cadastro. Para testes rápidos, desative em **Authentication → Providers → Email → Confirm email**.

Nunca coloque a chave `service_role` no frontend nem no `.env.local`. A chave `anon` é pública por definição; a segurança vem das políticas RLS do banco.

## Publicar (Vercel ou Netlify)

1. Suba a pasta para um repositório no GitHub.
2. Na Vercel (ou Netlify), importe o repositório. Build: `npm run build`; pasta de saída: `dist`.
3. Em **Environment Variables**, cadastre `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.
4. Depois do deploy, coloque a URL final em **Site URL** no Supabase (passo 6 acima).

## Segurança aplicada no banco

- Cada pessoa só lê o próprio extrato, resgates e avaliações pendentes; avaliações aprovadas são públicas.
- O cliente não consegue escolher autor, status ou nome ao enviar uma avaliação (trigger no banco).
- Não existe escrita direta em pontos: o crédito só acontece em `moderate_review()` (apenas moderação) e o débito em `redeem_benefit()`, que bloqueia saldo insuficiente e resgate duplicado.
- O papel de moderação não pode ser alterado pelo app.
- Mídias ficam em bucket privado; só ficam visíveis publicamente depois que a avaliação é aprovada.

Tudo isso foi testado com um Postgres local simulando o Supabase (tentativas de burlar status, nome, pontos e papel foram bloqueadas).

## Limitações conhecidas

- Catálogo, preços e benefícios continuam demonstrativos (sem checkout real).
- A pré-análise automática usa regras. Uma análise com IA generativa pode ser adicionada depois via Supabase Edge Function.
- Exclusão de conta pelo próprio usuário não está no app; é feita pela equipe no painel do Supabase.
