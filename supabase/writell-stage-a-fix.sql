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
