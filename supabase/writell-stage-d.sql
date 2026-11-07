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

/* ============================== LAST STEP ============================== */
-- Make yourself the owner of Writell: replace your_username with YOUR Writell username (keep the quotes), then Run.
update public.writell_profiles set staff = 'owner' where username = 'your_username';
