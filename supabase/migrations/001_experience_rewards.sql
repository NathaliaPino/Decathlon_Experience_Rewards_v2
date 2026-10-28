-- =====================================================================
-- Decathlon Experience Rewards — esquema de produção (Supabase / Postgres)
-- Execute este arquivo inteiro no Supabase: SQL Editor → New query → Run.
-- É idempotente o suficiente para ser executado novamente sem erro.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Perfis (minimização de dados: só primeiro nome e papel)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  first_name  text not null check (char_length(first_name) between 1 and 40),
  role        text not null default 'user' check (role in ('user', 'admin')),
  created_at  timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- Cria o perfil automaticamente no cadastro (primeiro nome vem do metadata do signUp).
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, first_name)
  values (new.id, left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'first_name'), ''), 'Participante'), 40))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin" on public.profiles
  for select using (id = auth.uid() or public.is_admin());
-- Sem políticas de insert/update/delete: o papel (role) não pode ser alterado pelo cliente.

-- ---------------------------------------------------------------------
-- 2. Benefícios (custos definidos no servidor)
-- ---------------------------------------------------------------------
create table if not exists public.benefits (
  id           text primary key,
  title        text not null,
  cost         integer not null check (cost > 0),
  code_prefix  text,
  active       boolean not null default true
);

insert into public.benefits (id, title, cost, code_prefix) values
  ('desconto',   '5% na sua próxima compra', 50,  'DEMO-5OFF'),
  ('frete',      'Frete grátis',             100, 'DEMO-FRETE'),
  ('antecipado', 'Acesso antecipado',        150, null)
on conflict (id) do update set title = excluded.title, cost = excluded.cost, code_prefix = excluded.code_prefix;

alter table public.benefits enable row level security;
drop policy if exists "benefits_select_all" on public.benefits;
create policy "benefits_select_all" on public.benefits for select using (true);

-- ---------------------------------------------------------------------
-- 3. Avaliações
-- ---------------------------------------------------------------------
create table if not exists public.reviews (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid references auth.users(id) on delete cascade,
  product_id       text not null default 'fleece',
  author_name      text not null,
  sport            text not null check (sport in ('Trilha','Corrida','Caminhada','Ciclismo','Camping','Outro')),
  level            text not null check (level in ('Iniciante','Intermediário','Avançado')),
  frequency        text not null check (frequency in ('Menos de 1 vez por semana','1 vez por semana','2–3 vezes por semana','4 ou mais vezes por semana')),
  rating           smallint check (rating between 1 and 5),
  body             text not null check (char_length(trim(body)) between 20 and 1000),
  usage_context    text,
  media_type       text check (media_type in ('photo','video')),
  media_path       text,
  media_consent    boolean not null default false,
  status           text not null default 'pending' check (status in ('pending','approved','rejected')),
  moderation_note  text check (char_length(moderation_note) <= 300),
  moderated_by     uuid references auth.users(id) on delete set null,
  moderated_at     timestamptz,
  is_demo          boolean not null default false,
  created_at       timestamptz not null default now(),
  constraint reviews_media_consistency check (
    (media_type is null and media_path is null)
    or (media_type is not null and media_path is not null and media_consent)
  )
);

create index if not exists reviews_status_product_idx on public.reviews (status, product_id, created_at desc);
create index if not exists reviews_user_idx on public.reviews (user_id, created_at desc);

-- Blindagem do insert: o cliente não escolhe autor, status, nome ou campos de moderação.
create or replace function public.reviews_before_insert()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new; -- inserções administrativas (SQL Editor / seed)
  end if;
  new.user_id         := auth.uid();
  new.author_name     := coalesce((select first_name from public.profiles where id = auth.uid()), 'Participante');
  new.status          := 'pending';
  new.is_demo         := false;
  new.rating          := null;
  new.usage_context   := null;
  new.moderation_note := null;
  new.moderated_by    := null;
  new.moderated_at    := null;
  new.created_at      := now();
  if new.media_path is not null and split_part(new.media_path, '/', 1) <> auth.uid()::text then
    raise exception 'invalid_media_path' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists reviews_before_insert on public.reviews;
create trigger reviews_before_insert
  before insert on public.reviews
  for each row execute function public.reviews_before_insert();

alter table public.reviews enable row level security;
drop policy if exists "reviews_select_visible" on public.reviews;
create policy "reviews_select_visible" on public.reviews
  for select using (status = 'approved' or user_id = auth.uid() or public.is_admin());
drop policy if exists "reviews_insert_own" on public.reviews;
create policy "reviews_insert_own" on public.reviews
  for insert to authenticated with check (user_id = auth.uid());
-- Sem update/delete pelo cliente: moderação só via função moderate_review().

-- ---------------------------------------------------------------------
-- 4. Extrato de pontos (livro-razão) e resgates
-- ---------------------------------------------------------------------
create table if not exists public.redemptions (
  id          uuid primary key,               -- id da operação gerado no cliente (idempotência)
  user_id     uuid not null references auth.users(id) on delete cascade,
  benefit_id  text not null references public.benefits(id),
  title       text not null,
  cost        integer not null check (cost > 0),
  code        text,
  created_at  timestamptz not null default now()
);
create index if not exists redemptions_user_idx on public.redemptions (user_id, created_at desc);

create table if not exists public.points_ledger (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references auth.users(id) on delete cascade,
  points         integer not null check (points <> 0),
  reason         text not null check (reason in ('review_approved','redemption')),
  review_id      uuid unique references public.reviews(id) on delete set null,   -- garante crédito único por avaliação
  redemption_id  uuid unique references public.redemptions(id) on delete cascade,
  description    text,
  created_at     timestamptz not null default now()
);
create index if not exists points_ledger_user_idx on public.points_ledger (user_id, created_at desc);

alter table public.redemptions enable row level security;
alter table public.points_ledger enable row level security;
drop policy if exists "redemptions_select_own" on public.redemptions;
create policy "redemptions_select_own" on public.redemptions
  for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists "ledger_select_own" on public.points_ledger;
create policy "ledger_select_own" on public.points_ledger
  for select using (user_id = auth.uid() or public.is_admin());
-- Sem escrita pelo cliente: créditos e débitos só acontecem dentro das funções abaixo.

-- ---------------------------------------------------------------------
-- 5. Regras de negócio atômicas
-- ---------------------------------------------------------------------
-- Moderação: aprovar publica a avaliação e credita 50 pontos uma única vez.
create or replace function public.moderate_review(p_review_id uuid, p_decision text, p_note text default null)
returns public.reviews
language plpgsql security definer
set search_path = public
as $$
declare
  r public.reviews;
begin
  if not public.is_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'invalid_decision';
  end if;

  update public.reviews
     set status = p_decision,
         moderation_note = left(nullif(trim(p_note), ''), 300),
         moderated_by = auth.uid(),
         moderated_at = now()
   where id = p_review_id and status = 'pending'
  returning * into r;

  if not found then
    raise exception 'review_not_pending' using errcode = 'P0002';
  end if;

  if p_decision = 'approved' and r.user_id is not null then
    insert into public.points_ledger (user_id, points, reason, review_id, description)
    values (r.user_id, 50, 'review_approved', r.id, 'Avaliação aprovada')
    on conflict (review_id) do nothing;
  end if;

  return r;
end;
$$;

-- Resgate: verifica saldo, debita e gera código num único passo, sem débito duplicado.
create or replace function public.redeem_benefit(p_operation_id uuid, p_benefit_id text)
returns json
language plpgsql security definer
set search_path = public
as $$
declare
  uid      uuid := auth.uid();
  b        public.benefits;
  existing public.redemptions;
  red      public.redemptions;
  bal      integer;
  v_code   text;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  -- Serializa resgates da mesma pessoa (evita gastar o mesmo saldo duas vezes).
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 42));

  select * into existing from public.redemptions where id = p_operation_id;
  if found then
    if existing.user_id = uid and existing.benefit_id = p_benefit_id then
      return json_build_object('ok', true, 'duplicate', true, 'redemption', row_to_json(existing),
        'balance', (select coalesce(sum(points), 0) from public.points_ledger where user_id = uid));
    end if;
    return json_build_object('ok', false, 'reason', 'invalid-operation');
  end if;

  select * into b from public.benefits where id = p_benefit_id and active;
  if not found then
    return json_build_object('ok', false, 'reason', 'unknown-benefit');
  end if;

  select coalesce(sum(points), 0) into bal from public.points_ledger where user_id = uid;
  if bal < b.cost then
    return json_build_object('ok', false, 'reason', 'insufficient-points', 'balance', bal);
  end if;

  v_code := case when b.code_prefix is null then null
                 else b.code_prefix || '-' || upper(substr(md5(p_operation_id::text || clock_timestamp()::text), 1, 8)) end;

  insert into public.redemptions (id, user_id, benefit_id, title, cost, code)
  values (p_operation_id, uid, b.id, b.title, b.cost, v_code)
  returning * into red;

  insert into public.points_ledger (user_id, points, reason, redemption_id, description)
  values (uid, -b.cost, 'redemption', red.id, b.title);

  return json_build_object('ok', true, 'duplicate', false, 'redemption', row_to_json(red), 'balance', bal - b.cost);
end;
$$;

revoke all on function public.moderate_review(uuid, text, text) from public, anon;
revoke all on function public.redeem_benefit(uuid, text) from public, anon;
grant execute on function public.moderate_review(uuid, text, text) to authenticated;
grant execute on function public.redeem_benefit(uuid, text) to authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.reviews_before_insert() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. Storage: fotos e vídeos das avaliações (bucket privado)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('review-media', 'review-media', false, 52428800,
        array['image/jpeg','image/png','image/webp','image/heic','image/heif','video/mp4','video/quicktime','video/webm'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types, public = false;

drop policy if exists "review_media_insert_own_folder" on storage.objects;
create policy "review_media_insert_own_folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'review-media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "review_media_delete_own_folder" on storage.objects;
create policy "review_media_delete_own_folder" on storage.objects
  for delete to authenticated
  using (bucket_id = 'review-media' and (storage.foldername(name))[1] = auth.uid()::text);

-- Leitura: dono, moderação, ou qualquer pessoa quando a avaliação já foi aprovada.
drop policy if exists "review_media_read" on storage.objects;
create policy "review_media_read" on storage.objects
  for select
  using (
    bucket_id = 'review-media' and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_admin()
      or exists (select 1 from public.reviews r where r.media_path = storage.objects.name and r.status = 'approved')
    )
  );

-- ---------------------------------------------------------------------
-- 7. Realtime (saldo e status atualizam sem recarregar a página)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['reviews', 'points_ledger', 'redemptions'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
              when undefined_object then raise notice 'Publicação supabase_realtime não encontrada; Realtime desativado.';
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 8. Relatos de exemplo (aparecem com a etiqueta "Exemplo")
-- ---------------------------------------------------------------------
insert into public.reviews (id, user_id, product_id, author_name, sport, level, frequency, rating, body, usage_context, status, is_demo, created_at, moderated_at)
values
  ('00000000-0000-4000-8000-000000000001', null, 'fleece', 'Marina', 'Trilha', 'Intermediário', '2–3 vezes por semana', 5,
   'Uso em trilhas curtas na serra, geralmente no começo da manhã. Aquece bem sem pesar na mochila. O corte é mais justo: para usar por cima de outra blusa, eu escolheria um tamanho maior.',
   'Trilhas de 8 a 12 km · manhãs frescas', 'approved', true, '2026-10-08 10:00:00+00', '2026-10-08 10:00:00+00'),
  ('00000000-0000-4000-8000-000000000002', null, 'fleece', 'Caio', 'Trilha', 'Iniciante', '1 vez por semana', 4,
   'Foi minha primeira blusa para trilha. É macia e ajuda no frio leve. Em lugares com muito vento, senti falta de uma camada por cima. Gostei do zíper para controlar o calor na subida.',
   'Passeios de 4 a 6 km · frio leve', 'approved', true, '2026-10-07 10:00:00+00', '2026-10-07 10:00:00+00'),
  ('00000000-0000-4000-8000-000000000003', null, 'fleece', 'Luiza', 'Corrida', 'Avançado', '4 ou mais vezes por semana', 5,
   'Uso antes e depois dos treinos, em dias frios. O tecido é confortável e seca rápido. Para correr com intensidade, prefiro uma peça mais leve, mas ela funciona bem no aquecimento.',
   'Antes e depois do treino · uso urbano', 'approved', true, '2026-10-06 10:00:00+00', '2026-10-06 10:00:00+00')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 9. Como tornar alguém moderador(a) — rode depois que a pessoa se cadastrar:
--    update public.profiles set role = 'admin'
--     where id = (select id from auth.users where email = 'email-da-moderacao@exemplo.com');
-- ---------------------------------------------------------------------
