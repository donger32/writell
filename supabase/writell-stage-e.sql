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
insert into public.writell_roles (id, name, color, rank, perms) values
  ('admin', 'Admin', '#5fa8f5', 200, array['rename','lock_names','titles_colors','give_badges','manage_badges','ban','moderate_chats','clear_profiles','announce','effects','reserve_names','filter_words','flags','view_log']),
  ('mod', 'Moderator', '#5fbf8f', 100, array['rename','lock_names','give_badges','ban','moderate_chats','clear_profiles','flags','view_log'])
on conflict (id) do nothing;

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
insert into public.writell_name_words (word, level) values
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
]) w on conflict (word) do nothing;

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
