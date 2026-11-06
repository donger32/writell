-- Writell stage A: profiles & friends. Paste into Supabase → SQL Editor → Run.

-- people: username, display name, picture, short bio, public key (for sharing projects privately later)
create table if not exists public.writell_profiles (
  id           uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  username     text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name text not null default '' check (char_length(display_name) <= 40),
  bio          text not null default '' check (char_length(bio) <= 300),
  avatar       text check (avatar is null or char_length(avatar) <= 300000),
  public_key   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- friend requests and friendships (one row per pair)
create table if not exists public.writell_friendships (
  requester   uuid not null references auth.users (id) on delete cascade,
  addressee   uuid not null references auth.users (id) on delete cascade,
  status      text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at  timestamptz not null default now(),
  accepted_at timestamptz,
  primary key (requester, addressee),
  check (requester <> addressee)
);
create unique index if not exists writell_friend_pair on public.writell_friendships (least(requester, addressee), greatest(requester, addressee));

-- blocked people
create table if not exists public.writell_blocks (
  blocker    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  blocked    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked)
);

-- "online now": only your friends can see it, and you can hide it
create table if not exists public.writell_presence (
  user_id   uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  last_seen timestamptz not null default now(),
  visible   boolean not null default true
);

-- your private key for shared projects, locked with your own data key
alter table public.writell_keys add column if not exists priv text;

-- helpers used by the rules below
create or replace function public.writell_blocked(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from writell_blocks where (blocker = a and blocked = b) or (blocker = b and blocked = a))
$$;
-- true when that person blocked YOU (you can still see people you blocked, so you can unblock them)
create or replace function public.writell_blocked_me(other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from writell_blocks where blocker = other and blocked = auth.uid())
$$;
create or replace function public.writell_are_friends(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from writell_friendships where status = 'accepted'
    and ((requester = a and addressee = b) or (requester = b and addressee = a)))
$$;

alter table public.writell_profiles    enable row level security;
alter table public.writell_friendships enable row level security;
alter table public.writell_blocks      enable row level security;
alter table public.writell_presence    enable row level security;

-- profiles: signed-in people can look each other up (unless one blocked the other); you edit only yours
drop policy if exists "see profiles" on public.writell_profiles;
create policy "see profiles" on public.writell_profiles for select to authenticated
  using (id = auth.uid() or not public.writell_blocked_me(id));
drop policy if exists "own profile" on public.writell_profiles;
create policy "own profile" on public.writell_profiles for insert to authenticated with check (id = auth.uid());
drop policy if exists "edit own profile" on public.writell_profiles;
create policy "edit own profile" on public.writell_profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists "delete own profile" on public.writell_profiles;
create policy "delete own profile" on public.writell_profiles for delete to authenticated using (id = auth.uid());

-- friendships: only the two people involved see a request; only the receiver can accept; either can remove
drop policy if exists "see own friendships" on public.writell_friendships;
create policy "see own friendships" on public.writell_friendships for select to authenticated
  using (auth.uid() in (requester, addressee));
drop policy if exists "send request" on public.writell_friendships;
create policy "send request" on public.writell_friendships for insert to authenticated
  with check (requester = auth.uid() and status = 'pending' and not public.writell_blocked(requester, addressee));
drop policy if exists "accept request" on public.writell_friendships;
create policy "accept request" on public.writell_friendships for update to authenticated
  using (addressee = auth.uid() and status = 'pending') with check (addressee = auth.uid() and status = 'accepted');
drop policy if exists "remove friendship" on public.writell_friendships;
create policy "remove friendship" on public.writell_friendships for delete to authenticated
  using (auth.uid() in (requester, addressee));

-- blocks: private to the person who blocked
drop policy if exists "own blocks" on public.writell_blocks;
create policy "own blocks" on public.writell_blocks for all to authenticated
  using (blocker = auth.uid()) with check (blocker = auth.uid());

-- online status: you, and your friends if you allow it
drop policy if exists "see presence" on public.writell_presence;
create policy "see presence" on public.writell_presence for select to authenticated
  using (user_id = auth.uid() or (visible and public.writell_are_friends(user_id, auth.uid())));
drop policy if exists "own presence" on public.writell_presence;
create policy "own presence" on public.writell_presence for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "update presence" on public.writell_presence;
create policy "update presence" on public.writell_presence for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on public.writell_profiles, public.writell_friendships, public.writell_blocks, public.writell_presence from anon;
grant select, insert, update, delete on public.writell_profiles, public.writell_friendships, public.writell_blocks, public.writell_presence to authenticated;
grant execute on function public.writell_blocked(uuid, uuid), public.writell_are_friends(uuid, uuid), public.writell_blocked_me(uuid) to authenticated;
