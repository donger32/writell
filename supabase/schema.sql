-- Inkwell collaboration backend (Stage 4) — Supabase / Postgres
-- Run in the Supabase SQL editor of YOUR project. Not used until collaboration ships.
-- Design: projects stay local unless shared. Shared projects sync as Yjs documents
-- (one per scene + one for project metadata). Every table is protected by Row Level
-- Security so the database itself refuses anyone who is not a member.

create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  username text unique not null check (username ~ '^[a-z0-9_]{3,24}$'),
  display_name text not null default '',
  avatar_url text,
  created_at timestamptz not null default now()
);

create type public.member_role as enum ('owner', 'editor', 'commenter', 'viewer');

create table public.projects (
  id uuid primary key,                       -- same id as the local project
  owner uuid not null references public.profiles on delete cascade,
  title text not null,
  e2e boolean not null default false,        -- true = content is encrypted on the device
  created_at timestamptz not null default now()
);

create table public.project_members (
  project_id uuid references public.projects on delete cascade,
  user_id uuid references public.profiles on delete cascade,
  role public.member_role not null,
  added_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create table public.documents (               -- Yjs updates, append-only
  id bigserial primary key,
  project_id uuid not null references public.projects on delete cascade,
  doc_key text not null,                     -- 'meta' or 'scene:<id>'
  update bytea not null,
  author uuid not null references public.profiles,
  created_at timestamptz not null default now()
);
create index on public.documents (project_id, doc_key, id);

create table public.invitations (
  token text primary key default encode(gen_random_bytes(24), 'base64url'),
  project_id uuid not null references public.projects on delete cascade,
  role public.member_role not null check (role <> 'owner'),
  created_by uuid not null references public.profiles,
  expires_at timestamptz not null default now() + interval '7 days',
  max_uses int not null default 1,
  uses int not null default 0
);

create table public.friendships (
  requester uuid references public.profiles on delete cascade,
  addressee uuid references public.profiles on delete cascade,
  status text not null check (status in ('pending', 'accepted', 'blocked')),
  created_at timestamptz not null default now(),
  primary key (requester, addressee)
);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects on delete cascade,
  scene_id uuid not null, anchor text, body text not null,
  author uuid not null references public.profiles, parent uuid references public.comments on delete cascade,
  resolved boolean not null default false, created_at timestamptz not null default now()
);

create table public.activity (
  id bigserial primary key,
  project_id uuid not null references public.projects on delete cascade,
  actor uuid not null references public.profiles, action text not null, target text, at timestamptz not null default now()
);

-- helpers
create or replace function public.role_in(p uuid) returns public.member_role language sql stable security definer set search_path = public as $$
  select role from project_members where project_id = p and user_id = auth.uid()
$$;

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.documents enable row level security;
alter table public.invitations enable row level security;
alter table public.friendships enable row level security;
alter table public.comments enable row level security;
alter table public.activity enable row level security;

create policy "profiles readable by signed-in users" on public.profiles for select to authenticated using (true);
create policy "edit own profile" on public.profiles for all to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "members see project" on public.projects for select to authenticated using (public.role_in(id) is not null);
create policy "create own project" on public.projects for insert to authenticated with check (owner = auth.uid());
create policy "owner updates/deletes" on public.projects for update to authenticated using (public.role_in(id) = 'owner');
create policy "owner deletes" on public.projects for delete to authenticated using (public.role_in(id) = 'owner');

create policy "members see members" on public.project_members for select to authenticated using (public.role_in(project_id) is not null);
create policy "owner manages members" on public.project_members for all to authenticated using (public.role_in(project_id) = 'owner') with check (public.role_in(project_id) = 'owner');
create policy "leave project" on public.project_members for delete to authenticated using (user_id = auth.uid() and role <> 'owner');

create policy "members read docs" on public.documents for select to authenticated using (public.role_in(project_id) is not null);
create policy "editors write docs" on public.documents for insert to authenticated with check (public.role_in(project_id) in ('owner', 'editor') and author = auth.uid());

create policy "owner manages invites" on public.invitations for all to authenticated using (public.role_in(project_id) = 'owner') with check (public.role_in(project_id) = 'owner');

create policy "see own friendships" on public.friendships for select to authenticated using (auth.uid() in (requester, addressee));
create policy "send request" on public.friendships for insert to authenticated with check (requester = auth.uid() and status = 'pending');
create policy "respond" on public.friendships for update to authenticated using (auth.uid() in (requester, addressee));
create policy "remove" on public.friendships for delete to authenticated using (auth.uid() in (requester, addressee));

create policy "members read comments" on public.comments for select to authenticated using (public.role_in(project_id) is not null);
create policy "commenters write" on public.comments for insert to authenticated with check (public.role_in(project_id) in ('owner', 'editor', 'commenter') and author = auth.uid());
create policy "author or editor updates" on public.comments for update to authenticated using (author = auth.uid() or public.role_in(project_id) in ('owner', 'editor'));

create policy "members read activity" on public.activity for select to authenticated using (public.role_in(project_id) is not null);
create policy "members log activity" on public.activity for insert to authenticated with check (public.role_in(project_id) is not null and actor = auth.uid());

-- accept an invitation link (runs with elevated rights but checks everything itself)
create or replace function public.accept_invite(t text) returns uuid language plpgsql security definer set search_path = public as $$
declare inv invitations;
begin
  select * into inv from invitations where token = t for update;
  if inv is null or inv.expires_at < now() or inv.uses >= inv.max_uses then raise exception 'Invitation is invalid or expired'; end if;
  insert into project_members (project_id, user_id, role) values (inv.project_id, auth.uid(), inv.role) on conflict do nothing;
  update invitations set uses = uses + 1 where token = t;
  return inv.project_id;
end $$;

-- the creator of a shared project automatically becomes its owner member
create or replace function public.add_owner_member() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into project_members (project_id, user_id, role) values (new.id, new.owner, 'owner');
  return new;
end $$;
create trigger projects_owner after insert on public.projects for each row execute function public.add_owner_member();
