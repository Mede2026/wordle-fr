-- Le Mot / Wordle — sauvegarde en ligne (une ligne par compte).
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
