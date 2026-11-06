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
