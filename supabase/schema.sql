-- Le Mot / Wordle — sauvegarde en ligne, amis et classement.
-- À coller une seule fois dans Supabase : SQL Editor → New query → Run.

create table if not exists public.saves (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Chacun ne voit et ne modifie que sa propre sauvegarde.
alter table public.saves enable row level security;

drop policy if exists "lire sa sauvegarde" on public.saves;
create policy "lire sa sauvegarde" on public.saves
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "créer sa sauvegarde" on public.saves;
create policy "créer sa sauvegarde" on public.saves
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "modifier sa sauvegarde" on public.saves;
create policy "modifier sa sauvegarde" on public.saves
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update on public.saves to authenticated;

-- ---------- Amis et classement ----------

-- Profil visible par les amis : pseudo + code ami
create table if not exists public.profiles (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  pseudo      text not null check (char_length(pseudo) between 1 and 20),
  friend_code text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  stats       jsonb not null default '{}'::jsonb, -- { fr: { streak, maxStreak, played, wins, last }, en: … }
  created_at  timestamptz not null default now()
);
alter table public.profiles add column if not exists stats jsonb not null default '{}'::jsonb;

-- Amitiés (toujours dans les deux sens)
create table if not exists public.friends (
  user_id    uuid not null references auth.users (id) on delete cascade,
  friend_id  uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  check (user_id <> friend_id)
);
create index if not exists friends_friend_id_idx on public.friends (friend_id);

-- Résultat de chaque mot du jour (pour le classement et les séries)
create table if not exists public.results (
  user_id uuid not null references auth.users (id) on delete cascade,
  lang    text not null check (lang in ('fr', 'en')),
  day     date not null,
  won     boolean not null,
  guesses smallint not null check (guesses between 1 and 6),
  hard    boolean not null default false,
  primary key (user_id, lang, day)
);
create index if not exists results_lang_day_idx on public.results (lang, day);

alter table public.profiles enable row level security;
alter table public.friends  enable row level security;
alter table public.results  enable row level security;

create or replace function public.is_friend(other uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.friends where user_id = (select auth.uid()) and friend_id = other);
$$;

drop policy if exists "voir son profil et ceux de ses amis" on public.profiles;
create policy "voir son profil et ceux de ses amis" on public.profiles
  for select to authenticated using (user_id = (select auth.uid()) or public.is_friend(user_id));
drop policy if exists "créer son profil" on public.profiles;
create policy "créer son profil" on public.profiles
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "modifier son profil" on public.profiles;
create policy "modifier son profil" on public.profiles
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "voir ses amitiés" on public.friends;
create policy "voir ses amitiés" on public.friends
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "voir ses résultats et ceux de ses amis" on public.results;
create policy "voir ses résultats et ceux de ses amis" on public.results
  for select to authenticated using (user_id = (select auth.uid()) or public.is_friend(user_id));
drop policy if exists "ajouter ses résultats" on public.results;
create policy "ajouter ses résultats" on public.results
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "modifier ses résultats" on public.results;
create policy "modifier ses résultats" on public.results
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Ajouter un ami avec son code (les profils des inconnus restent invisibles)
create or replace function public.add_friend(code text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  other uuid;
  other_pseudo text;
begin
  if me is null then raise exception 'not_signed_in'; end if;
  select user_id, pseudo into other, other_pseudo from public.profiles where friend_code = upper(trim(code));
  if other is null then raise exception 'code_not_found'; end if;
  if other = me then raise exception 'own_code'; end if;
  insert into public.friends (user_id, friend_id) values (me, other), (other, me) on conflict do nothing;
  return other_pseudo;
end;
$$;

create or replace function public.remove_friend(other uuid)
returns void language sql security definer set search_path = '' as $$
  delete from public.friends
  where (user_id = (select auth.uid()) and friend_id = other)
     or (user_id = other and friend_id = (select auth.uid()));
$$;

revoke execute on function public.is_friend(uuid), public.add_friend(text), public.remove_friend(uuid) from public, anon;
grant execute on function public.is_friend(uuid), public.add_friend(text), public.remove_friend(uuid) to authenticated;

grant select, insert, update on public.profiles to authenticated;
grant select on public.friends to authenticated;
grant select, insert, update on public.results to authenticated;

-- ---------- Rappel quotidien (notifications push) ----------

-- Abonnements aux notifications (un par appareil)
create table if not exists public.push_subscriptions (
  endpoint   text primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  lang       text not null check (lang in ('fr', 'en')),
  tz         text not null,               -- fuseau de l'appareil (ex. America/Montreal)
  hour       smallint not null check (hour between 0 and 23),
  last_sent  date,                        -- dernier rappel envoyé (date locale)
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;

drop policy if exists "voir ses abonnements" on public.push_subscriptions;
create policy "voir ses abonnements" on public.push_subscriptions
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "créer ses abonnements" on public.push_subscriptions;
create policy "créer ses abonnements" on public.push_subscriptions
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "modifier ses abonnements" on public.push_subscriptions;
create policy "modifier ses abonnements" on public.push_subscriptions
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "supprimer ses abonnements" on public.push_subscriptions;
create policy "supprimer ses abonnements" on public.push_subscriptions
  for delete to authenticated using (user_id = (select auth.uid()));

grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant select, update, delete on public.push_subscriptions to service_role;

-- Secrets lus seulement par la fonction serveur (service_role) : clés VAPID.
-- Remplir une fois (générer une paire de clés VAPID, ex. `npx web-push generate-vapid-keys`) :
--   insert into public.app_secrets values ('vapid_public', '…'), ('vapid_private', '…');
-- La clé publique va aussi dans assets/js/config.js (vapidPublicKey).
create table if not exists public.app_secrets (
  name  text primary key,
  value text not null
);
alter table public.app_secrets enable row level security; -- aucune règle : invisible pour les joueurs
revoke all on public.app_secrets from anon, authenticated;
grant select on public.app_secrets to service_role;

-- La fonction serveur lit aussi profils et résultats (série, déjà joué ?)
grant select on public.profiles, public.results to service_role;

-- Appel de la fonction supabase/functions/daily-reminder toutes les heures
-- (remplacer <projet> par l'identifiant du projet Supabase)
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;
-- select cron.schedule('rappel-quotidien', '0 * * * *', $$
--   select net.http_post(
--     url := 'https://<projet>.supabase.co/functions/v1/daily-reminder',
--     headers := '{"Content-Type": "application/json"}'::jsonb,
--     body := '{}'::jsonb,
--     timeout_milliseconds := 30000)
-- $$);

-- ---------- « Un ami a fait mieux que toi » (notification push) ----------

-- Chaque appareil choisit ses notifications : rappel quotidien et/ou ami qui fait mieux.
alter table public.push_subscriptions
  add column if not exists remind  boolean not null default true,
  add column if not exists friends boolean not null default false;

-- Une seule notification par ami et par jour.
create table if not exists public.friend_beats (
  from_id uuid not null references auth.users (id) on delete cascade,
  to_id   uuid not null references auth.users (id) on delete cascade,
  lang    text not null,
  day     date not null,
  primary key (from_id, to_id, lang, day)
);
alter table public.friend_beats enable row level security; -- aucune règle : réservé à la fonction serveur
revoke all on public.friend_beats from anon, authenticated;
grant select, insert on public.friend_beats to service_role;
grant select on public.friends to service_role;

-- Secrets du déclencheur : adresse des fonctions + clé partagée avec la fonction serveur. Remplir une fois :
--   insert into public.app_secrets values
--     ('functions_url', 'https://<projet>.supabase.co/functions/v1'),
--     ('trigger_secret', gen_random_uuid()::text || gen_random_uuid()::text);

-- Quand un joueur gagne le mot du jour (ou améliore son résultat), on appelle la fonction serveur.
create or replace function public.notify_friend_beat()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  fn_url text;
  secret text;
begin
  if not new.won or new.day < current_date - 1 then return new; end if;
  if tg_op = 'UPDATE' and old.won = new.won and old.guesses = new.guesses then return new; end if;
  select value into fn_url from public.app_secrets where name = 'functions_url';
  select value into secret from public.app_secrets where name = 'trigger_secret';
  if fn_url is null or secret is null then return new; end if;
  perform net.http_post(
    url := fn_url || '/daily-reminder',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-trigger-secret', secret),
    body := jsonb_build_object('result', jsonb_build_object('user_id', new.user_id, 'lang', new.lang, 'day', new.day)),
    timeout_milliseconds := 10000);
  return new;
end;
$$;
revoke execute on function public.notify_friend_beat() from public, anon, authenticated;

drop trigger if exists results_friend_beat on public.results;
create trigger results_friend_beat
  after insert or update on public.results
  for each row execute function public.notify_friend_beat();
