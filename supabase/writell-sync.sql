-- Writell: account sync setup. Paste all of this into Supabase → SQL Editor → Run.
-- Everything stored here is encrypted on your device first; the server only sees scrambled data.

-- 1. Your encrypted items (projects, chapters, scenes, characters, …)
create sequence if not exists public.writell_seq;

create table if not exists public.writell_items (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  tbl     text not null,               -- which kind of item (scenes, entities, …)
  id      text not null,               -- the item's random id
  deleted boolean not null default false,
  data    text,                        -- encrypted contents
  seq     bigint not null default nextval('public.writell_seq'),
  primary key (user_id, tbl, id)
);
create index if not exists writell_items_seq on public.writell_items (user_id, seq);

-- every change gets a new number, so devices can ask "what changed since #123?"
create or replace function public.writell_bump() returns trigger
language plpgsql as $$ begin new.seq := nextval('public.writell_seq'); return new; end $$;
drop trigger if exists writell_bump on public.writell_items;
create trigger writell_bump before insert or update on public.writell_items
  for each row execute function public.writell_bump();

-- 2. Your encryption key, locked with your password (and separately with your recovery key)
create table if not exists public.writell_keys (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  salt       text not null,
  wrapped    text not null,
  rsalt      text not null,
  rwrapped   text not null,
  created_at timestamptz not null default now()
);

-- 3. Nobody can see or change anyone else's rows
alter table public.writell_items enable row level security;
alter table public.writell_keys  enable row level security;

drop policy if exists "own items" on public.writell_items;
create policy "own items" on public.writell_items for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "own key" on public.writell_keys;
create policy "own key" on public.writell_keys for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on public.writell_items, public.writell_keys from anon;
grant select, insert, update, delete on public.writell_items, public.writell_keys to authenticated;
grant usage, select on sequence public.writell_seq to authenticated;
