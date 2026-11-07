-- Writell database setup: everything in one file.
-- Paste the whole file into Supabase → SQL Editor → Run. It's safe to run again any time:
-- when an update needs database changes, this file gets updated and you just run it again.
-- Nothing in here can read anyone's writing: projects, chats and keys are encrypted on people's devices.

-- remembers one-time steps (starter roles and word lists), so running this again never brings back things you deleted
create table if not exists public.writell_setup (step text primary key, done_at timestamptz not null default now());
alter table public.writell_setup enable row level security;


/* ######################################################################
   ACCOUNTS & ENCRYPTED SYNC
   ###################################################################### */

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


/* ######################################################################
   PROFILES, FRIENDS, BLOCKING, ONLINE STATUS
   ###################################################################### */

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


/* ######################################################################
   BLOCKED LIST FIX
   ###################################################################### */

-- Writell stage A fix: let you see the people you blocked (so you can unblock them).
-- People who blocked you stay hidden from you. Paste into Supabase → SQL Editor → Run.
create or replace function public.writell_blocked_me(other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from writell_blocks where blocker = other and blocked = auth.uid())
$$;
grant execute on function public.writell_blocked_me(uuid) to authenticated;
drop policy if exists "see profiles" on public.writell_profiles;
create policy "see profiles" on public.writell_profiles for select to authenticated
  using (id = auth.uid() or not public.writell_blocked_me(id));


/* ######################################################################
   SHARED PROJECTS & INVITE LINKS
   ###################################################################### */

-- Writell stage B: sharing projects with friends. Paste into Supabase → SQL Editor → Run.
-- Shared projects stay end-to-end encrypted: each one has its own key, and only members get a copy
-- (locked with their personal key). The server can see who is in a project, never what's in it.

create table if not exists public.writell_projects (
  id         text primary key,
  owner      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.writell_members (
  project_id text not null references public.writell_projects (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       text not null check (role in ('owner', 'editor', 'commenter', 'viewer')),
  key_grant  text,                         -- the project key, locked for this member
  added_by   uuid default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create table if not exists public.writell_shared_items (
  project_id text not null references public.writell_projects (id) on delete cascade,
  tbl        text not null,
  id         text not null,
  deleted    boolean not null default false,
  data       text,                         -- encrypted with the project key
  seq        bigint not null default nextval('public.writell_seq'),
  updated_by uuid default auth.uid(),
  primary key (project_id, tbl, id)
);
create index if not exists writell_shared_seq on public.writell_shared_items (seq);
drop trigger if exists writell_bump on public.writell_shared_items;
create trigger writell_bump before insert or update on public.writell_shared_items
  for each row execute function public.writell_bump();

create table if not exists public.writell_invites (
  token      text primary key,
  project_id text not null references public.writell_projects (id) on delete cascade,
  role       text not null check (role in ('editor', 'commenter', 'viewer')),
  key_wrap   text not null,               -- project key locked with the secret half of the link (never sent here)
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  uses       int not null default 0
);

-- helpers
create or replace function public.writell_role(p text) returns text
language sql stable security definer set search_path = public as $$
  select role from writell_members where project_id = p and user_id = auth.uid()
$$;

alter table public.writell_projects     enable row level security;
alter table public.writell_members      enable row level security;
alter table public.writell_shared_items enable row level security;
alter table public.writell_invites      enable row level security;

drop policy if exists "members see project" on public.writell_projects;
create policy "members see project" on public.writell_projects for select to authenticated
  using (owner = auth.uid() or public.writell_role(id) is not null);
drop policy if exists "create own project" on public.writell_projects;
create policy "create own project" on public.writell_projects for insert to authenticated with check (owner = auth.uid());
drop policy if exists "owner deletes project" on public.writell_projects;
create policy "owner deletes project" on public.writell_projects for delete to authenticated using (owner = auth.uid());

drop policy if exists "members see members" on public.writell_members;
create policy "members see members" on public.writell_members for select to authenticated
  using (public.writell_role(project_id) is not null);
drop policy if exists "owner adds" on public.writell_members;
create policy "owner adds" on public.writell_members for insert to authenticated with check (
  (public.writell_role(project_id) = 'owner' and role <> 'owner' and public.writell_are_friends(auth.uid(), user_id))
  or (user_id = auth.uid() and role = 'owner' and exists (select 1 from writell_projects where id = project_id and owner = auth.uid()))
);
drop policy if exists "owner changes roles" on public.writell_members;
create policy "owner changes roles" on public.writell_members for update to authenticated
  using (public.writell_role(project_id) = 'owner') with check (role <> 'owner' or user_id = auth.uid());
drop policy if exists "remove or leave" on public.writell_members;
create policy "remove or leave" on public.writell_members for delete to authenticated using (
  (public.writell_role(project_id) = 'owner' and user_id <> auth.uid()) or (user_id = auth.uid() and role <> 'owner')
);

drop policy if exists "members read items" on public.writell_shared_items;
create policy "members read items" on public.writell_shared_items for select to authenticated
  using (public.writell_role(project_id) is not null);
drop policy if exists "editors add items" on public.writell_shared_items;
create policy "editors add items" on public.writell_shared_items for insert to authenticated
  with check (public.writell_role(project_id) in ('owner', 'editor') and updated_by = auth.uid());
drop policy if exists "editors change items" on public.writell_shared_items;
create policy "editors change items" on public.writell_shared_items for update to authenticated
  using (public.writell_role(project_id) in ('owner', 'editor'))
  with check (public.writell_role(project_id) in ('owner', 'editor') and updated_by = auth.uid());

drop policy if exists "owner manages invites" on public.writell_invites;
create policy "owner manages invites" on public.writell_invites for all to authenticated
  using (public.writell_role(project_id) = 'owner') with check (public.writell_role(project_id) = 'owner' and created_by = auth.uid());

-- joining with an invite link
create or replace function public.writell_accept_invite(t text) returns json
language plpgsql security definer set search_path = public as $$
declare inv writell_invites;
begin
  select * into inv from writell_invites where token = t and expires_at > now();
  if not found then raise exception 'This invite link has expired or was turned off.'; end if;
  insert into writell_members (project_id, user_id, role, added_by) values (inv.project_id, auth.uid(), inv.role, inv.created_by)
    on conflict (project_id, user_id) do nothing;
  update writell_invites set uses = uses + 1 where token = t;
  return json_build_object('project_id', inv.project_id, 'role', (select role from writell_members where project_id = inv.project_id and user_id = auth.uid()), 'key_wrap', inv.key_wrap);
end $$;

-- after joining by link: store your own locked copy of the project key
create or replace function public.writell_set_my_grant(p text, g text) returns void
language sql security definer set search_path = public as $$
  update writell_members set key_grant = g where project_id = p and user_id = auth.uid();
$$;

-- hand the project to another member (you become an editor)
create or replace function public.writell_transfer_owner(p text, new_owner uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.writell_role(p) <> 'owner' then raise exception 'Only the owner can do that.'; end if;
  if not exists (select 1 from writell_members where project_id = p and user_id = new_owner) then raise exception 'They need to be in the project first.'; end if;
  update writell_members set role = 'owner' where project_id = p and user_id = new_owner;
  update writell_members set role = 'editor' where project_id = p and user_id = auth.uid();
  update writell_projects set owner = new_owner where id = p;
end $$;

revoke all on public.writell_projects, public.writell_members, public.writell_shared_items, public.writell_invites from anon;
grant select, insert, update, delete on public.writell_projects, public.writell_members, public.writell_shared_items, public.writell_invites to authenticated;
grant execute on function public.writell_role(text), public.writell_accept_invite(text), public.writell_set_my_grant(text, text), public.writell_transfer_owner(text, uuid) to authenticated;
revoke execute on function public.writell_accept_invite(text), public.writell_set_my_grant(text, text), public.writell_transfer_owner(text, uuid) from anon;


/* ######################################################################
   PROJECT CHAT, COMMENTS, ADMIN TOOLS
   ###################################################################### */

-- Writell stage D: project chat, comments for co-writers, and admin tools.
-- Paste into Supabase → SQL Editor → Run. Then do the LAST STEP at the bottom.
-- Chat messages are encrypted with the project's key, like everything else in a shared project:
-- the server (and admins) can see who wrote when, never what.

/* ============================== profiles: staff, badges & bans ============================== */
alter table public.writell_profiles add column if not exists staff text check (staff in ('owner', 'admin', 'mod'));
alter table public.writell_profiles add column if not exists badges text[] not null default '{}';
alter table public.writell_profiles add column if not exists name_color text check (name_color is null or char_length(name_color) <= 20);
alter table public.writell_profiles add column if not exists title text check (title is null or char_length(title) <= 40);
alter table public.writell_profiles add column if not exists name_locked boolean not null default false;
alter table public.writell_profiles add column if not exists banned_until timestamptz;
alter table public.writell_profiles add column if not exists ban_reason text check (ban_reason is null or char_length(ban_reason) <= 200);

-- usernames nobody can take (admins hand them out)
create table if not exists public.writell_reserved (
  name       text primary key check (name ~ '^[a-z0-9_]{3,20}$'),
  note       text not null default '',
  created_at timestamptz not null default now()
);

create or replace function public.writell_rank(u uuid) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select case staff when 'owner' then 3 when 'admin' then 2 when 'mod' then 1 else 0 end from writell_profiles where id = u), 0)
$$;
create or replace function public.writell_is_banned(u uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from writell_profiles where id = u and banned_until is not null and banned_until > now())
$$;

-- people can edit their own profile, but not their rank, badges, color, title, lock or ban
-- (the admin tools below run as the database owner, so they can)
create or replace function public.writell_profile_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.staff := null; new.badges := '{}'; new.name_color := null; new.title := null;
      new.name_locked := false; new.banned_until := null; new.ban_reason := null;
    else
      new.staff := old.staff; new.badges := old.badges; new.name_color := old.name_color; new.title := old.title;
      new.name_locked := old.name_locked; new.banned_until := old.banned_until; new.ban_reason := old.ban_reason;
      if old.name_locked and (new.username <> old.username or new.display_name <> old.display_name) then
        raise exception 'An admin locked your name, so you can''t change it right now.';
      end if;
    end if;
    if (tg_op = 'INSERT' or new.username <> old.username) and exists (select 1 from writell_reserved where name = new.username) then
      raise exception 'That username is reserved.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists writell_profile_guard on public.writell_profiles;
create trigger writell_profile_guard before insert or update on public.writell_profiles
  for each row execute function public.writell_profile_guard();

-- banned people can't send friend requests
drop policy if exists "send request" on public.writell_friendships;
create policy "send request" on public.writell_friendships for insert to authenticated
  with check (requester = auth.uid() and status = 'pending' and not public.writell_blocked(requester, addressee) and not public.writell_is_banned(auth.uid()));

/* ============================== project chat ============================== */
create table if not exists public.writell_messages (
  id         uuid primary key default gen_random_uuid(),
  project_id text not null references public.writell_projects (id) on delete cascade,
  author     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind       text not null default 'msg' check (kind in ('msg', 'comment', 'activity')),
  reply_to   uuid,
  data       text check (data is null or char_length(data) <= 20000),   -- encrypted with the project key
  resolved   boolean not null default false,
  deleted    boolean not null default false,
  created_at timestamptz not null default now(),
  edited_at  timestamptz,
  seq        bigint not null default nextval('public.writell_seq')
);
create index if not exists writell_messages_seq on public.writell_messages (project_id, seq);
drop trigger if exists writell_bump on public.writell_messages;
create trigger writell_bump before insert or update on public.writell_messages
  for each row execute function public.writell_bump();

-- editors can resolve or remove anyone's message, but only the author can rewrite it
create or replace function public.writell_message_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.id <> old.id or new.project_id <> old.project_id or new.author <> old.author or new.kind <> old.kind
     or new.created_at <> old.created_at or new.reply_to is distinct from old.reply_to then
    raise exception 'That can''t be changed.';
  end if;
  if old.deleted then raise exception 'That message was already removed.'; end if;
  if new.deleted then new.data := null; return new; end if;
  if auth.uid() is distinct from old.author and (new.data is distinct from old.data or new.edited_at is distinct from old.edited_at) then
    raise exception 'You can only edit your own messages.';
  end if;
  return new;
end $$;
drop trigger if exists writell_message_guard on public.writell_messages;
create trigger writell_message_guard before update on public.writell_messages
  for each row execute function public.writell_message_guard();

alter table public.writell_messages enable row level security;
drop policy if exists "members read chat" on public.writell_messages;
create policy "members read chat" on public.writell_messages for select to authenticated
  using (public.writell_role(project_id) is not null);
drop policy if exists "members write chat" on public.writell_messages;
create policy "members write chat" on public.writell_messages for insert to authenticated with check (
  author = auth.uid() and not deleted and not public.writell_is_banned(auth.uid()) and (
    (kind = 'msg' and public.writell_role(project_id) is not null)
    or (kind = 'comment' and public.writell_role(project_id) in ('owner', 'editor', 'commenter'))
    or (kind = 'activity' and public.writell_role(project_id) in ('owner', 'editor'))
  ));
drop policy if exists "change chat" on public.writell_messages;
create policy "change chat" on public.writell_messages for update to authenticated
  using (author = auth.uid() or public.writell_role(project_id) in ('owner', 'editor'))
  with check (author = auth.uid() or public.writell_role(project_id) in ('owner', 'editor'));

/* ============================== announcements & fun effects ============================== */
create table if not exists public.writell_announcements (
  id         bigserial primary key,
  text       text not null check (char_length(text) between 1 and 500),
  style      text not null default 'info' check (style in ('info', 'party', 'warning', 'love')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  expires_at timestamptz
);
create table if not exists public.writell_effects (
  id         bigserial primary key,
  kind       text not null check (kind in ('confetti', 'snow', 'hearts', 'shout', 'shake', 'spotlight')),
  target     uuid references auth.users (id) on delete cascade,    -- empty = everyone
  text       text check (text is null or char_length(text) <= 200),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create table if not exists public.writell_admin_log (
  id      bigserial primary key,
  actor   uuid,
  target  uuid,
  action  text not null,
  details text,
  at      timestamptz not null default now()
);

alter table public.writell_reserved      enable row level security;
alter table public.writell_announcements enable row level security;
alter table public.writell_effects       enable row level security;
alter table public.writell_admin_log     enable row level security;

drop policy if exists "see reserved" on public.writell_reserved;
create policy "see reserved" on public.writell_reserved for select to authenticated using (true);
drop policy if exists "admins reserve" on public.writell_reserved;
create policy "admins reserve" on public.writell_reserved for all to authenticated
  using (public.writell_rank(auth.uid()) >= 2) with check (public.writell_rank(auth.uid()) >= 2);

drop policy if exists "see announcements" on public.writell_announcements;
create policy "see announcements" on public.writell_announcements for select to authenticated
  using (expires_at is null or expires_at > now() or public.writell_rank(auth.uid()) >= 1);
drop policy if exists "admins announce" on public.writell_announcements;
create policy "admins announce" on public.writell_announcements for all to authenticated
  using (public.writell_rank(auth.uid()) >= 2) with check (public.writell_rank(auth.uid()) >= 2 and created_by = auth.uid());

drop policy if exists "see effects" on public.writell_effects;
create policy "see effects" on public.writell_effects for select to authenticated
  using (target is null or target = auth.uid() or created_by = auth.uid());
drop policy if exists "staff send effects" on public.writell_effects;
create policy "staff send effects" on public.writell_effects for insert to authenticated
  with check (public.writell_rank(auth.uid()) >= 1 and created_by = auth.uid());

drop policy if exists "staff read log" on public.writell_admin_log;
create policy "staff read log" on public.writell_admin_log for select to authenticated
  using (public.writell_rank(auth.uid()) >= 1);

/* ============================== admin tools ============================== */
create or replace function public.writell_admin_overview() returns json
language plpgsql security definer set search_path = public as $$
begin
  if writell_rank(auth.uid()) < 1 then raise exception 'Only staff can do that.'; end if;
  return json_build_object(
    'accounts',        (select count(*) from auth.users),
    'profiles',        (select count(*) from writell_profiles),
    'new_week',        (select count(*) from writell_profiles where created_at > now() - interval '7 days'),
    'online',          (select count(*) from writell_presence where last_seen > now() - interval '3 minutes'),
    'active_week',     (select count(*) from writell_presence where last_seen > now() - interval '7 days'),
    'friendships',     (select count(*) from writell_friendships where status = 'accepted'),
    'shared_projects', (select count(*) from writell_projects),
    'messages_today',  (select count(*) from writell_messages where created_at > now() - interval '1 day' and kind <> 'activity'),
    'messages',        (select count(*) from writell_messages where kind <> 'activity'),
    'banned',          (select count(*) from writell_profiles where banned_until > now()),
    'staff',           (select count(*) from writell_profiles where staff is not null)
  );
end $$;

-- everyone (or a search), with their last activity; pictures are left out to keep it quick
drop function if exists public.writell_admin_people(text);
create or replace function public.writell_admin_people(q text default '')
returns table (id uuid, username text, display_name text, bio text, has_avatar boolean, staff text, badges text[], name_color text, title text,
               name_locked boolean, banned_until timestamptz, ban_reason text, created_at timestamptz, last_seen timestamptz, projects bigint, friends bigint)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  if writell_rank(auth.uid()) < 1 then raise exception 'Only staff can do that.'; end if;
  return query
    select p.id, p.username, p.display_name, p.bio, p.avatar is not null, p.staff, p.badges, p.name_color, p.title,
           p.name_locked, p.banned_until, p.ban_reason, p.created_at, pr.last_seen,
           (select count(*) from writell_members m where m.user_id = p.id),
           (select count(*) from writell_friendships f where f.status = 'accepted' and p.id in (f.requester, f.addressee))
    from writell_profiles p left join writell_presence pr on pr.user_id = p.id
    where coalesce(q, '') = '' or p.username ilike q || '%' or p.display_name ilike '%' || q || '%'
    order by pr.last_seen desc nulls last
    limit 200;
end $$;

create or replace function public.writell_admin_update(target uuid, changes jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare me int := writell_rank(auth.uid()); them int := writell_rank(target); k text;
begin
  if me < 1 then raise exception 'Only staff can do that.'; end if;
  if target <> auth.uid() and them >= me then raise exception 'You can''t change someone with the same rank as you or higher.'; end if;
  if target = auth.uid() and changes ? 'banned_until' then raise exception 'You can''t ban yourself.'; end if;
  for k in select jsonb_object_keys(changes) loop
    if k not in ('username', 'display_name', 'bio', 'avatar', 'badges', 'name_color', 'title', 'name_locked', 'banned_until', 'ban_reason') then
      raise exception 'Unknown change: %', k;
    end if;
  end loop;
  if changes ? 'username' and exists (select 1 from writell_profiles where username = changes->>'username' and id <> target) then
    raise exception 'That username is taken.';
  end if;
  update writell_profiles set
    username     = coalesce(changes->>'username', username),
    display_name = case when changes ? 'display_name' then coalesce(changes->>'display_name', '') else display_name end,
    bio          = case when changes ? 'bio' then coalesce(changes->>'bio', '') else bio end,
    avatar       = case when changes ? 'avatar' then changes->>'avatar' else avatar end,
    badges       = case when changes ? 'badges' then array(select jsonb_array_elements_text(changes->'badges')) else badges end,
    name_color   = case when changes ? 'name_color' then nullif(changes->>'name_color', '') else name_color end,
    title        = case when changes ? 'title' then nullif(changes->>'title', '') else title end,
    name_locked  = case when changes ? 'name_locked' then (changes->>'name_locked')::boolean else name_locked end,
    banned_until = case when changes ? 'banned_until' then (changes->>'banned_until')::timestamptz else banned_until end,
    ban_reason   = case when changes ? 'ban_reason' then nullif(changes->>'ban_reason', '') else ban_reason end,
    updated_at   = now()
  where id = target;
  insert into writell_admin_log (actor, target, action, details) values (auth.uid(), target, 'update', (changes - 'avatar')::text);
end $$;

-- only the owner hands out staff ranks
create or replace function public.writell_admin_set_staff(target uuid, rank text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if writell_rank(auth.uid()) < 3 then raise exception 'Only the owner can change staff ranks.'; end if;
  if target = auth.uid() then raise exception 'You can''t change your own rank.'; end if;
  if rank is not null and rank not in ('admin', 'mod') then raise exception 'Unknown rank.'; end if;
  update writell_profiles set staff = rank where id = target;
  insert into writell_admin_log (actor, target, action, details) values (auth.uid(), target, 'rank', coalesce(rank, 'none'));
end $$;

/* ============================== permissions ============================== */
revoke all on public.writell_messages, public.writell_reserved, public.writell_announcements, public.writell_effects, public.writell_admin_log from anon;
grant select, insert, update on public.writell_messages to authenticated;
grant select, insert, update, delete on public.writell_reserved, public.writell_announcements to authenticated;
grant select, insert on public.writell_effects to authenticated;
grant select on public.writell_admin_log to authenticated;
grant usage, select on sequence public.writell_announcements_id_seq, public.writell_effects_id_seq to authenticated;
grant execute on function public.writell_rank(uuid), public.writell_is_banned(uuid), public.writell_admin_overview(), public.writell_admin_people(text),
  public.writell_admin_update(uuid, jsonb), public.writell_admin_set_staff(uuid, text) to authenticated;
revoke execute on function public.writell_admin_overview(), public.writell_admin_people(text), public.writell_admin_update(uuid, jsonb), public.writell_admin_set_staff(uuid, text) from anon;


/* ######################################################################
   SPECIAL USERNAMES
   ###################################################################### */

-- Writell: special usernames. Paste into Supabase → SQL Editor → Run (after stage D).
-- Admins can give anyone a username of 1–24 characters with any letters, symbols or emoji
-- (no spaces). Normal sign-ups still pick 3–20 lowercase letters, numbers or _.

alter table public.writell_profiles drop constraint if exists writell_profiles_username_check;
alter table public.writell_profiles drop constraint if exists writell_username_shape;
alter table public.writell_profiles add constraint writell_username_shape
  check (char_length(username) between 1 and 24 and username !~ '[[:space:][:cntrl:]]');

alter table public.writell_reserved drop constraint if exists writell_reserved_name_check;
alter table public.writell_reserved drop constraint if exists writell_reserved_shape;
alter table public.writell_reserved add constraint writell_reserved_shape
  check (char_length(name) between 1 and 24 and name !~ '[[:space:][:cntrl:]]');

-- people choosing their own username keep the normal rules; special names come from admins
create or replace function public.writell_profile_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.staff := null; new.badges := '{}'; new.name_color := null; new.title := null;
      new.name_locked := false; new.banned_until := null; new.ban_reason := null;
    else
      new.staff := old.staff; new.badges := old.badges; new.name_color := old.name_color; new.title := old.title;
      new.name_locked := old.name_locked; new.banned_until := old.banned_until; new.ban_reason := old.ban_reason;
      if old.name_locked and (new.username <> old.username or new.display_name <> old.display_name) then
        raise exception 'An admin locked your name, so you can''t change it right now.';
      end if;
    end if;
    if (tg_op = 'INSERT' or new.username <> old.username) then
      if new.username !~ '^[a-z0-9_]{3,20}$' then
        raise exception 'Usernames are 3–20 lowercase letters, numbers or _.';
      end if;
      if exists (select 1 from writell_reserved where name = new.username) then
        raise exception 'That username is reserved.';
      end if;
    end if;
  end if;
  return new;
end $$;


/* ######################################################################
   ROLES & PERMISSIONS, CUSTOM BADGES, NAME FILTER, CHAT MUTES
   ###################################################################### */

-- Writell stage E: custom roles & permissions, custom badges, a name filter with flags for staff, chat mutes.
-- Paste into Supabase → SQL Editor → Run (after stage D and the special-names script). Safe to run again.

/* ============================== roles & permissions ============================== */
-- Permissions a role can have:
--   rename          change usernames & display names (incl. special names, surprise rename)
--   lock_names      lock / unlock someone's name
--   titles_colors   give titles and name colors
--   give_badges     give / take away badges
--   manage_badges   create, edit and delete badges
--   ban             ban / unban
--   moderate_chats  mute someone in all chats, remove all their chat messages
--   clear_profiles  clear bios and pictures
--   announce        post announcements
--   effects         send confetti, shouts and other effects
--   reserve_names   reserve usernames
--   filter_words    edit the blocked / flagged word lists
--   flags           see and handle flagged names
--   view_log        see the admin log
-- The owner has every permission and is the only one who can create roles and give them out.
create table if not exists public.writell_roles (
  id         text primary key check (id ~ '^[a-z0-9_-]{1,30}$'),
  name       text not null check (char_length(name) between 1 and 30),
  color      text not null default '#5fa8f5' check (char_length(color) <= 20),
  rank       int not null default 10 check (rank between 1 and 999),
  perms      text[] not null default '{}',
  created_at timestamptz not null default now()
);
insert into public.writell_roles (id, name, color, rank, perms)
select * from (values
  ('admin', 'Admin', '#5fa8f5', 200, array['rename','lock_names','titles_colors','give_badges','manage_badges','ban','moderate_chats','clear_profiles','announce','effects','reserve_names','filter_words','flags','view_log']),
  ('mod', 'Moderator', '#5fbf8f', 100, array['rename','lock_names','give_badges','ban','moderate_chats','clear_profiles','flags','view_log'])
) v(id, name, color, rank, perms)
where not exists (select 1 from public.writell_setup where step = 'starter roles')
on conflict (id) do nothing;
insert into public.writell_setup (step) values ('starter roles') on conflict do nothing;

alter table public.writell_profiles drop constraint if exists writell_profiles_staff_check;
alter table public.writell_profiles add column if not exists chat_muted_until timestamptz;

create or replace function public.writell_rank(u uuid) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select case when p.staff = 'owner' then 1000 else coalesce(r.rank, 0) end
                   from writell_profiles p left join writell_roles r on r.id = p.staff where p.id = u), 0)
$$;
create or replace function public.writell_can(u uuid, perm text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from writell_profiles p left join writell_roles r on r.id = p.staff
                 where p.id = u and (p.staff = 'owner' or perm = any (r.perms)))
$$;
create or replace function public.writell_chat_muted(u uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from writell_profiles where id = u and chat_muted_until is not null and chat_muted_until > now())
$$;

-- deleting a role takes it away from everyone who had it
create or replace function public.writell_role_gone() returns trigger
language plpgsql security definer set search_path = public as $$
begin update writell_profiles set staff = null where staff = old.id; return old; end $$;
drop trigger if exists writell_role_gone on public.writell_roles;
create trigger writell_role_gone after delete on public.writell_roles for each row execute function public.writell_role_gone();

alter table public.writell_roles enable row level security;
drop policy if exists "see roles" on public.writell_roles;
create policy "see roles" on public.writell_roles for select to authenticated using (true);
drop policy if exists "owner manages roles" on public.writell_roles;
create policy "owner manages roles" on public.writell_roles for all to authenticated
  using (public.writell_rank(auth.uid()) >= 1000) with check (public.writell_rank(auth.uid()) >= 1000);

/* ============================== custom badges ============================== */
create table if not exists public.writell_badges (
  id          text primary key default replace(gen_random_uuid()::text, '-', ''),
  emoji       text not null check (char_length(emoji) between 1 and 8),
  label       text not null check (char_length(label) between 1 and 40),
  color       text check (color is null or char_length(color) <= 20),
  description text check (description is null or char_length(description) <= 120),
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);
-- deleting a badge takes it away from everyone
create or replace function public.writell_badge_gone() returns trigger
language plpgsql security definer set search_path = public as $$
begin update writell_profiles set badges = array_remove(badges, old.id) where old.id = any (badges); return old; end $$;
drop trigger if exists writell_badge_gone on public.writell_badges;
create trigger writell_badge_gone after delete on public.writell_badges for each row execute function public.writell_badge_gone();
-- the old built-in badges are gone
update public.writell_profiles set badges = array(select b from unnest(badges) b where exists (select 1 from public.writell_badges x where x.id = b))
  where badges <> '{}';

alter table public.writell_badges enable row level security;
drop policy if exists "see badges" on public.writell_badges;
create policy "see badges" on public.writell_badges for select to authenticated using (true);
drop policy if exists "staff manage badges" on public.writell_badges;
create policy "staff manage badges" on public.writell_badges for all to authenticated
  using (public.writell_can(auth.uid(), 'manage_badges')) with check (public.writell_can(auth.uid(), 'manage_badges'));

/* ============================== name filter ============================== */
-- block = nobody can pick a name containing it; flag = allowed, but staff see it in Flags;
-- allow = innocent words that contain a bad one ("Scunthorpe", "cocktail"): ignored when checking
create table if not exists public.writell_name_words (
  word       text primary key check (char_length(word) between 2 and 40),
  level      text not null default 'block' check (level in ('block', 'flag', 'allow')),
  created_at timestamptz not null default now()
);
insert into public.writell_name_words (word, level)
select * from (values
  ('nigger','block'), ('nigga','block'), ('niggr','block'), ('nigr','block'), ('negro','block'), ('coon','flag'), ('chink','block'), ('gook','block'),
  ('spic','block'), ('wetback','block'), ('kike','block'), ('raghead','block'), ('towelhead','block'), ('beaner','block'), ('tranny','block'),
  ('faggot','block'), ('fag','block'), ('dyke','block'), ('retard','block'),
  ('fuck','block'), ('fuk','block'), ('fck','block'), ('shit','block'), ('bitch','block'), ('cunt','block'), ('dick','block'), ('cock','block'),
  ('pussy','block'), ('penis','block'), ('vagina','block'), ('whore','block'), ('slut','block'), ('porn','block'), ('dildo','block'),
  ('rape','block'), ('rapist','block'), ('molest','block'), ('pedo','block'), ('paedo','block'), ('cum','flag'), ('sex','flag'), ('tits','block'),
  ('boob','flag'), ('ass','flag'), ('anal','flag'), ('anus','block'), ('bastard','block'), ('wank','block'), ('twat','block'), ('prick','flag'),
  ('hitler','block'), ('adolf','flag'), ('nazi','block'), ('heilhitler','block'), ('siegheil','block'), ('swastika','block'), ('reich','flag'),
  ('fuhrer','block'), ('himmler','block'), ('goebbels','block'), ('stalin','block'), ('mussolini','block'), ('polpot','block'), ('mao','flag'),
  ('osama','flag'), ('binladen','block'), ('isis','flag'), ('kkk','block'), ('kys','block'), ('killyourself','block'), ('suicide','flag')
) v(word, level)
where not exists (select 1 from public.writell_setup where step = 'starter words')
on conflict (word) do nothing;
alter table public.writell_name_words drop constraint if exists writell_name_words_level_check;
alter table public.writell_name_words add constraint writell_name_words_level_check check (level in ('block', 'flag', 'allow'));
insert into public.writell_name_words (word, level)
select w, 'allow' from unnest(array[
  'scunthorpe','cocktail','cockatoo','cockpit','cockroach','peacock','hancock','shuttlecock','dickens','dickinson','dickson','benedick',
  'assassin','class','classic','pass','grass','glass','brass','bass','mass','lass','sass','assist','assume','assault','assemble','embassy','ambassador','compass','harass','cassie','cassidy','assam',
  'shitake','shiitake','therapist','grape','drape','scrape','spice','spicy','torpedo','pedometer','pedal','encyclopedia','uranus','janus','manus',
  'sussex','essex','cucumber','document','circumstance','scum','analysis','analyst','canal','banal','analog','raccoon','cocoon','tycoon',
  'prickly','bigger','digger','jigger','trigger','tigger','snigger','niger','nigeria','hitchcock','titsworth','matsuo'
]) w
where not exists (select 1 from public.writell_setup where step = 'starter words')
on conflict (word) do nothing;
insert into public.writell_setup (step) values ('starter words') on conflict do nothing;

create or replace function public.writell_norm(t text) returns text language sql immutable as $$
  -- lower case, look-alike numbers and symbols to letters (0→o, 1→i, 3→e, 4→a, 5→s, 7→t, 8→b, @→a, $→s, !→i, |→l), letters only
  select regexp_replace(translate(lower(coalesce(t, '')), '0134578@$!|', 'oieastbasil'), '[^a-z]', '', 'g')
$$;
-- a word as a pattern that also matches stretched spellings ("fuuuck")
create or replace function public.writell_word_re(w text) returns text language sql immutable as $$
  select string_agg(c || '+', '') from regexp_split_to_table(writell_norm(w), '') c
$$;
-- edit distance of at most 1 (one letter added, removed or changed)
create or replace function public.writell_close1(a text, b text) returns boolean language plpgsql immutable as $$
declare la int := length(a); lb int := length(b); i int := 1; j int := 1; d int := 0;
begin
  if abs(la - lb) > 1 then return false; end if;
  while i <= la and j <= lb loop
    if substr(a, i, 1) <> substr(b, j, 1) then
      d := d + 1; if d > 1 then return false; end if;
      if la > lb then i := i + 1; elsif lb > la then j := j + 1; else i := i + 1; j := j + 1; end if;
    else i := i + 1; j := j + 1; end if;
  end loop;
  return d + (la - i + 1) + (lb - j + 1) <= 1;
end $$;

-- what's wrong with a name, if anything: rows of (level, word, how)
create or replace function public.writell_name_check(n text) returns table (level text, word text, how text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare nn text := writell_norm(n); w record; nw text; l int; i int;
begin
  -- innocent words are taken out first ("cocktail" → "")
  for w in select x.word from writell_name_words x where x.level = 'allow' order by length(x.word) desc loop
    nn := replace(nn, writell_norm(w.word), '');
  end loop;
  if nn = '' then return; end if;
  for w in select x.word, x.level from writell_name_words x where x.level <> 'allow' loop
    if nn ~ writell_word_re(w.word) then
      level := w.level; word := w.word; how := 'contains'; return next; continue;
    end if;
    -- close to a blocked word (one letter off), only for longer words to avoid noise
    nw := writell_norm(w.word); l := length(nw);
    if w.level = 'block' and l >= 5 then
      for i in 1 .. greatest(1, length(nn) - l + 2) loop
        if writell_close1(substr(nn, i, l), nw) or writell_close1(substr(nn, i, l + 1), nw) or writell_close1(substr(nn, i, l - 1), nw) then
          level := 'flag'; word := w.word; how := 'close'; return next; exit;
        end if;
      end loop;
    end if;
  end loop;
end $$;

-- flagged names, for staff
create table if not exists public.writell_name_flags (
  id          bigserial primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  field       text not null check (field in ('username', 'display_name')),
  name        text not null,
  word        text not null,
  how         text not null,
  status      text not null default 'open' check (status in ('open', 'ok', 'fixed')),
  created_at  timestamptz not null default now(),
  reviewed_by uuid,
  reviewed_at timestamptz
);
create or replace function public.writell_flag_name(u uuid, f text, n text) returns int
language plpgsql security definer set search_path = public as $$
declare r record; c int := 0;
begin
  for r in select * from writell_name_check(n) loop
    if not exists (select 1 from writell_name_flags x where x.user_id = u and x.field = f and x.name = n and x.word = r.word) then
      insert into writell_name_flags (user_id, field, name, word, how) values (u, f, n, r.word, r.how); c := c + 1;
    end if;
  end loop;
  return c;
end $$;
revoke execute on function public.writell_flag_name(uuid, text, text) from public, anon, authenticated;

alter table public.writell_name_words enable row level security;
alter table public.writell_name_flags enable row level security;
drop policy if exists "staff see words" on public.writell_name_words;
create policy "staff see words" on public.writell_name_words for select to authenticated
  using (public.writell_can(auth.uid(), 'filter_words') or public.writell_can(auth.uid(), 'flags'));
drop policy if exists "staff edit words" on public.writell_name_words;
create policy "staff edit words" on public.writell_name_words for all to authenticated
  using (public.writell_can(auth.uid(), 'filter_words')) with check (public.writell_can(auth.uid(), 'filter_words'));
drop policy if exists "staff see flags" on public.writell_name_flags;
create policy "staff see flags" on public.writell_name_flags for select to authenticated using (public.writell_can(auth.uid(), 'flags'));
drop policy if exists "staff handle flags" on public.writell_name_flags;
create policy "staff handle flags" on public.writell_name_flags for update to authenticated
  using (public.writell_can(auth.uid(), 'flags')) with check (public.writell_can(auth.uid(), 'flags'));

/* ============================== profile rules ============================== */
create or replace function public.writell_profile_guard() returns trigger
language plpgsql set search_path = public as $$
declare bad text;
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.staff := null; new.badges := '{}'; new.name_color := null; new.title := null;
      new.name_locked := false; new.banned_until := null; new.ban_reason := null; new.chat_muted_until := null;
    else
      new.staff := old.staff; new.badges := old.badges; new.name_color := old.name_color; new.title := old.title;
      new.name_locked := old.name_locked; new.banned_until := old.banned_until; new.ban_reason := old.ban_reason; new.chat_muted_until := old.chat_muted_until;
      if old.name_locked and (new.username <> old.username or new.display_name <> old.display_name) then
        raise exception 'An admin locked your name, so you can''t change it right now.';
      end if;
    end if;
    if (tg_op = 'INSERT' or new.username <> old.username) then
      if new.username !~ '^[a-z0-9_]{3,20}$' then raise exception 'Usernames are 3–20 lowercase letters, numbers or _.'; end if;
      if exists (select 1 from writell_reserved where name = new.username) then raise exception 'That username is reserved.'; end if;
      select c.word into bad from writell_name_check(new.username) c where c.level = 'block' and c.how = 'contains' limit 1;
      if bad is not null then raise exception 'That username isn''t allowed. Please pick another.'; end if;
    end if;
    if (tg_op = 'INSERT' or new.display_name <> old.display_name) and new.display_name <> '' then
      select c.word into bad from writell_name_check(new.display_name) c where c.level = 'block' and c.how = 'contains' limit 1;
      if bad is not null then raise exception 'That name isn''t allowed. Please pick another.'; end if;
    end if;
  end if;
  return new;
end $$;

-- names that are allowed but look iffy go to the Flags tab
create or replace function public.writell_profile_flags() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.username <> old.username then perform writell_flag_name(new.id, 'username', new.username); end if;
  if new.display_name <> '' and (tg_op = 'INSERT' or new.display_name <> old.display_name) then perform writell_flag_name(new.id, 'display_name', new.display_name); end if;
  return null;
end $$;
drop trigger if exists writell_profile_flags on public.writell_profiles;
create trigger writell_profile_flags after insert or update on public.writell_profiles for each row execute function public.writell_profile_flags();

-- chat-muted people can't post in any chat
drop policy if exists "members write chat" on public.writell_messages;
create policy "members write chat" on public.writell_messages for insert to authenticated with check (
  author = auth.uid() and not deleted and not public.writell_is_banned(auth.uid()) and not public.writell_chat_muted(auth.uid()) and (
    (kind = 'msg' and public.writell_role(project_id) is not null)
    or (kind = 'comment' and public.writell_role(project_id) in ('owner', 'editor', 'commenter'))
    or (kind = 'activity' and public.writell_role(project_id) in ('owner', 'editor'))
  ));

/* ============================== permission checks for the other admin tools ============================== */
drop policy if exists "admins reserve" on public.writell_reserved;
create policy "admins reserve" on public.writell_reserved for all to authenticated
  using (public.writell_can(auth.uid(), 'reserve_names')) with check (public.writell_can(auth.uid(), 'reserve_names'));
drop policy if exists "admins announce" on public.writell_announcements;
create policy "admins announce" on public.writell_announcements for all to authenticated
  using (public.writell_can(auth.uid(), 'announce')) with check (public.writell_can(auth.uid(), 'announce') and created_by = auth.uid());
drop policy if exists "staff send effects" on public.writell_effects;
create policy "staff send effects" on public.writell_effects for insert to authenticated
  with check (public.writell_can(auth.uid(), 'effects') and created_by = auth.uid());
drop policy if exists "staff read log" on public.writell_admin_log;
create policy "staff read log" on public.writell_admin_log for select to authenticated using (public.writell_can(auth.uid(), 'view_log'));

drop function if exists public.writell_admin_people(text);
create or replace function public.writell_admin_people(q text default '')
returns table (id uuid, username text, display_name text, bio text, has_avatar boolean, staff text, badges text[], name_color text, title text,
               name_locked boolean, banned_until timestamptz, ban_reason text, chat_muted_until timestamptz, created_at timestamptz, last_seen timestamptz,
               projects bigint, friends bigint, open_flags bigint)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  if writell_rank(auth.uid()) < 1 then raise exception 'Only staff can do that.'; end if;
  return query
    select p.id, p.username, p.display_name, p.bio, p.avatar is not null, p.staff, p.badges, p.name_color, p.title,
           p.name_locked, p.banned_until, p.ban_reason, p.chat_muted_until, p.created_at, pr.last_seen,
           (select count(*) from writell_members m where m.user_id = p.id),
           (select count(*) from writell_friendships f where f.status = 'accepted' and p.id in (f.requester, f.addressee)),
           (select count(*) from writell_name_flags nf where nf.user_id = p.id and nf.status = 'open')
    from writell_profiles p left join writell_presence pr on pr.user_id = p.id
    where coalesce(q, '') = '' or p.username ilike q || '%' or p.display_name ilike '%' || q || '%'
    order by pr.last_seen desc nulls last
    limit 200;
end $$;

create or replace function public.writell_admin_overview() returns json
language plpgsql security definer set search_path = public as $$
begin
  if writell_rank(auth.uid()) < 1 then raise exception 'Only staff can do that.'; end if;
  return json_build_object(
    'accounts',        (select count(*) from auth.users),
    'profiles',        (select count(*) from writell_profiles),
    'new_week',        (select count(*) from writell_profiles where created_at > now() - interval '7 days'),
    'online',          (select count(*) from writell_presence where last_seen > now() - interval '3 minutes'),
    'active_week',     (select count(*) from writell_presence where last_seen > now() - interval '7 days'),
    'friendships',     (select count(*) from writell_friendships where status = 'accepted'),
    'shared_projects', (select count(*) from writell_projects),
    'messages_today',  (select count(*) from writell_messages where created_at > now() - interval '1 day' and kind <> 'activity'),
    'messages',        (select count(*) from writell_messages where kind <> 'activity'),
    'banned',          (select count(*) from writell_profiles where banned_until > now()),
    'staff',           (select count(*) from writell_profiles where staff is not null),
    'open_flags',      (select count(*) from writell_name_flags where status = 'open')
  );
end $$;

-- each change needs its own permission
create or replace function public.writell_admin_update(target uuid, changes jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); k text; need text;
begin
  if writell_rank(me) < 1 then raise exception 'Only staff can do that.'; end if;
  if target <> me and writell_rank(target) >= writell_rank(me) then raise exception 'You can''t change someone with the same rank as you or higher.'; end if;
  if target = me and (changes ? 'banned_until' or changes ? 'chat_muted_until') then raise exception 'You can''t ban or mute yourself.'; end if;
  for k in select jsonb_object_keys(changes) loop
    need := case k
      when 'username' then 'rename' when 'display_name' then 'rename'
      when 'name_locked' then 'lock_names'
      when 'title' then 'titles_colors' when 'name_color' then 'titles_colors'
      when 'badges' then 'give_badges'
      when 'banned_until' then 'ban' when 'ban_reason' then 'ban'
      when 'chat_muted_until' then 'moderate_chats'
      when 'bio' then 'clear_profiles' when 'avatar' then 'clear_profiles'
      else null end;
    if need is null then raise exception 'Unknown change: %', k; end if;
    if not writell_can(me, need) then raise exception 'Your role isn''t allowed to do that (%).', need; end if;
  end loop;
  if changes ? 'username' and exists (select 1 from writell_profiles where username = changes->>'username' and id <> target) then
    raise exception 'That username is taken.';
  end if;
  update writell_profiles set
    username         = coalesce(changes->>'username', username),
    display_name     = case when changes ? 'display_name' then coalesce(changes->>'display_name', '') else display_name end,
    bio              = case when changes ? 'bio' then coalesce(changes->>'bio', '') else bio end,
    avatar           = case when changes ? 'avatar' then changes->>'avatar' else avatar end,
    badges           = case when changes ? 'badges' then array(select jsonb_array_elements_text(changes->'badges')) else badges end,
    name_color       = case when changes ? 'name_color' then nullif(changes->>'name_color', '') else name_color end,
    title            = case when changes ? 'title' then nullif(changes->>'title', '') else title end,
    name_locked      = case when changes ? 'name_locked' then (changes->>'name_locked')::boolean else name_locked end,
    banned_until     = case when changes ? 'banned_until' then (changes->>'banned_until')::timestamptz else banned_until end,
    ban_reason       = case when changes ? 'ban_reason' then nullif(changes->>'ban_reason', '') else ban_reason end,
    chat_muted_until = case when changes ? 'chat_muted_until' then (changes->>'chat_muted_until')::timestamptz else chat_muted_until end,
    updated_at       = now()
  where id = target;
  -- a staff rename sorts out that person's name flags
  if changes ? 'username' or changes ? 'display_name' then
    update writell_name_flags set status = 'fixed', reviewed_by = me, reviewed_at = now() where user_id = target and status = 'open';
  end if;
  insert into writell_admin_log (actor, target, action, details) values (me, target, 'update', (changes - 'avatar')::text);
end $$;

-- only the owner gives out roles
drop function if exists public.writell_admin_set_staff(uuid, text);
create or replace function public.writell_admin_set_staff(target uuid, rank text) returns void
language plpgsql security definer set search_path = public as $$
#variable_conflict use_variable
begin
  if writell_rank(auth.uid()) < 1000 then raise exception 'Only the owner can give out roles.'; end if;
  if target = auth.uid() then raise exception 'You can''t change your own role.'; end if;
  if rank is not null and not exists (select 1 from writell_roles where id = rank) then raise exception 'That role doesn''t exist.'; end if;
  update writell_profiles set staff = rank where id = target;
  insert into writell_admin_log (actor, target, action, details) values (auth.uid(), target, 'rank', coalesce((select name from writell_roles where id = rank), 'none'));
end $$;

-- remove everything someone wrote in chats (without reading it: it stays encrypted)
create or replace function public.writell_admin_wipe_messages(target uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not writell_can(auth.uid(), 'moderate_chats') then raise exception 'Your role isn''t allowed to do that (moderate_chats).'; end if;
  if target <> auth.uid() and writell_rank(target) >= writell_rank(auth.uid()) then raise exception 'You can''t change someone with the same rank as you or higher.'; end if;
  update writell_messages set deleted = true where author = target and not deleted and kind <> 'activity';
  get diagnostics n = row_count;
  insert into writell_admin_log (actor, target, action, details) values (auth.uid(), target, 'wipe', n::text);
  return n;
end $$;

-- check everyone's current names against the word list
create or replace function public.writell_admin_scan_names() returns int
language plpgsql security definer set search_path = public as $$
declare p record; n int := 0;
begin
  if not writell_can(auth.uid(), 'flags') then raise exception 'Your role isn''t allowed to do that (flags).'; end if;
  for p in select id, username, display_name from writell_profiles loop
    n := n + writell_flag_name(p.id, 'username', p.username);
    if p.display_name <> '' then n := n + writell_flag_name(p.id, 'display_name', p.display_name); end if;
  end loop;
  return n;
end $$;

/* ============================== permissions ============================== */
revoke all on public.writell_roles, public.writell_badges, public.writell_name_words, public.writell_name_flags from anon;
grant select, insert, update, delete on public.writell_roles, public.writell_badges, public.writell_name_words to authenticated;
grant select, update on public.writell_name_flags to authenticated;
grant execute on function public.writell_can(uuid, text), public.writell_chat_muted(uuid), public.writell_name_check(text), public.writell_norm(text),
  public.writell_word_re(text), public.writell_close1(text, text), public.writell_admin_people(text), public.writell_admin_overview(),
  public.writell_admin_update(uuid, jsonb), public.writell_admin_set_staff(uuid, text), public.writell_admin_wipe_messages(uuid),
  public.writell_admin_scan_names() to authenticated;
revoke execute on function public.writell_admin_people(text), public.writell_admin_overview(), public.writell_admin_update(uuid, jsonb),
  public.writell_admin_set_staff(uuid, text), public.writell_admin_wipe_messages(uuid), public.writell_admin_scan_names(), public.writell_name_check(text) from anon;

-- look at everyone's current names once
do $$ declare p record; begin
  for p in select id, username, display_name from public.writell_profiles loop
    perform public.writell_flag_name(p.id, 'username', p.username);
    if p.display_name <> '' then perform public.writell_flag_name(p.id, 'display_name', p.display_name); end if;
  end loop;
end $$;


/* ######################################################################
   OWNER
   ###################################################################### */
-- Only needed once, to make yourself the owner: put your username between the quotes.
-- If you're already the owner, leave it as it is: it does nothing.
update public.writell_profiles set staff = 'owner' where username = 'your_username';
