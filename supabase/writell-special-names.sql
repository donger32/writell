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
