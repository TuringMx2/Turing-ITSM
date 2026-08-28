-- Tenant organization, teams, projects, and independent membership relations.

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  name text not null,
  description text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint teams_name_check check (char_length(btrim(name)) between 2 and 100),
  constraint teams_description_check check (
    description is null or char_length(description) <= 1000
  ),
  constraint teams_creator_tenant_fk
    foreign key (tenant_id, created_by)
    references public.profiles (tenant_id, id)
    on delete restrict,
  unique (tenant_id, id),
  unique (tenant_id, name)
);

create table public.team_memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  team_id uuid not null,
  user_id uuid not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint team_memberships_team_tenant_fk
    foreign key (tenant_id, team_id)
    references public.teams (tenant_id, id)
    on delete cascade,
  constraint team_memberships_profile_tenant_fk
    foreign key (tenant_id, user_id)
    references public.profiles (tenant_id, id)
    on delete cascade,
  constraint team_memberships_creator_tenant_fk
    foreign key (tenant_id, created_by)
    references public.profiles (tenant_id, id)
    on delete restrict,
  unique (team_id, user_id),
  unique (tenant_id, team_id, user_id)
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  team_id uuid not null,
  name text not null,
  description text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint projects_name_check check (char_length(btrim(name)) between 2 and 100),
  constraint projects_description_check check (
    description is null or char_length(description) <= 1000
  ),
  constraint projects_team_tenant_fk
    foreign key (tenant_id, team_id)
    references public.teams (tenant_id, id)
    on delete restrict,
  constraint projects_creator_tenant_fk
    foreign key (tenant_id, created_by)
    references public.profiles (tenant_id, id)
    on delete restrict,
  unique (tenant_id, id),
  unique (team_id, name)
);

create table public.project_memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  user_id uuid not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint project_memberships_project_tenant_fk
    foreign key (tenant_id, project_id)
    references public.projects (tenant_id, id)
    on delete cascade,
  constraint project_memberships_profile_tenant_fk
    foreign key (tenant_id, user_id)
    references public.profiles (tenant_id, id)
    on delete cascade,
  constraint project_memberships_creator_tenant_fk
    foreign key (tenant_id, created_by)
    references public.profiles (tenant_id, id)
    on delete restrict,
  unique (project_id, user_id),
  unique (tenant_id, project_id, user_id)
);

create function private.is_team_member(p_tenant_id uuid, p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.team_memberships tm
    where tm.tenant_id = p_tenant_id
      and tm.team_id = p_team_id
      and tm.user_id = (select auth.uid())
      and p_tenant_id = private.current_tenant_id()
  )
$$;

create function private.is_project_member(p_tenant_id uuid, p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.project_memberships pm
    where pm.tenant_id = p_tenant_id
      and pm.project_id = p_project_id
      and pm.user_id = (select auth.uid())
      and p_tenant_id = private.current_tenant_id()
  )
$$;

create function private.can_manage_project(p_tenant_id uuid, p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_tenant_admin(p_tenant_id)
    or private.is_project_member(p_tenant_id, p_project_id)
$$;

create function private.shares_internal_membership(
  p_tenant_id uuid,
  p_other_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_tenant_id = private.current_tenant_id()
  and (
    exists (
    select 1
    from public.team_memberships mine
    join public.team_memberships theirs
      on theirs.team_id = mine.team_id
    where mine.user_id = (select auth.uid())
      and mine.tenant_id = p_tenant_id
      and theirs.tenant_id = p_tenant_id
      and theirs.user_id = p_other_user_id
    ) or exists (
    select 1
    from public.project_memberships mine
    join public.project_memberships theirs
      on theirs.project_id = mine.project_id
    where mine.user_id = (select auth.uid())
      and mine.tenant_id = p_tenant_id
      and theirs.tenant_id = p_tenant_id
      and theirs.user_id = p_other_user_id
    )
  )
$$;

alter function private.is_team_member(uuid, uuid) owner to postgres;
alter function private.is_project_member(uuid, uuid) owner to postgres;
alter function private.can_manage_project(uuid, uuid) owner to postgres;
alter function private.shares_internal_membership(uuid, uuid) owner to postgres;

revoke execute on function private.is_team_member(uuid, uuid) from public;
revoke execute on function private.is_project_member(uuid, uuid) from public;
revoke execute on function private.can_manage_project(uuid, uuid) from public;
revoke execute on function private.shares_internal_membership(uuid, uuid) from public;
grant execute on function private.is_team_member(uuid, uuid) to authenticated;
grant execute on function private.is_project_member(uuid, uuid) to authenticated;
grant execute on function private.can_manage_project(uuid, uuid) to authenticated;
grant execute on function private.shares_internal_membership(uuid, uuid) to authenticated;

create function private.assert_internal_membership()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_role public.app_role;
begin
  select p.role into v_role
  from public.profiles p
  where p.id = new.user_id and p.tenant_id = new.tenant_id;
  if v_role not in ('support_agent', 'admin') then
    raise exception 'Team and project memberships require an internal user';
  end if;
  return new;
end;
$$;

create function private.prevent_member_role_demotion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.role in ('support_agent', 'admin')
     and new.role not in ('support_agent', 'admin')
     and (
       exists (select 1 from public.team_memberships tm where tm.user_id = old.id)
       or exists (select 1 from public.project_memberships pm where pm.user_id = old.id)
     ) then
    raise exception 'Remove team and project memberships before changing to a customer role';
  end if;
  return new;
end;
$$;

create trigger assert_team_membership_internal
before insert or update on public.team_memberships
for each row execute function private.assert_internal_membership();

create trigger assert_project_membership_internal
before insert or update on public.project_memberships
for each row execute function private.assert_internal_membership();

create trigger prevent_profile_member_role_demotion
before update of role on public.profiles
for each row execute function private.prevent_member_role_demotion();

create trigger set_teams_updated_at
before update on public.teams
for each row execute function private.set_updated_at();

create trigger set_projects_updated_at
before update on public.projects
for each row execute function private.set_updated_at();

revoke execute on function private.assert_internal_membership() from public;
revoke execute on function private.prevent_member_role_demotion() from public;

create index teams_tenant_idx on public.teams (tenant_id);
create index team_memberships_user_idx on public.team_memberships (user_id);
create index projects_tenant_team_idx on public.projects (tenant_id, team_id);
create index project_memberships_user_idx on public.project_memberships (user_id);

alter table public.teams enable row level security;
alter table public.team_memberships enable row level security;
alter table public.projects enable row level security;
alter table public.project_memberships enable row level security;

create policy teams_read_scope on public.teams
for select to authenticated
using (
  private.is_tenant_admin(tenant_id)
  or private.is_team_member(tenant_id, id)
);

create policy teams_admin_insert on public.teams
for insert to authenticated
with check (
  private.is_tenant_admin(tenant_id)
  and created_by = (select auth.uid())
);

create policy teams_admin_update on public.teams
for update to authenticated
using (private.is_tenant_admin(tenant_id))
with check (private.is_tenant_admin(tenant_id));

create policy teams_admin_delete on public.teams
for delete to authenticated
using (private.is_tenant_admin(tenant_id));

create policy team_memberships_read_scope on public.team_memberships
for select to authenticated
using (
  private.is_tenant_admin(tenant_id)
  or private.is_team_member(tenant_id, team_id)
);

create policy team_memberships_admin_insert on public.team_memberships
for insert to authenticated
with check (
  private.is_tenant_admin(tenant_id)
  and created_by = (select auth.uid())
);

create policy team_memberships_admin_delete on public.team_memberships
for delete to authenticated
using (private.is_tenant_admin(tenant_id));

create policy projects_read_scope on public.projects
for select to authenticated
using (
  private.is_tenant_admin(tenant_id)
  or private.is_project_member(tenant_id, id)
);

create policy projects_admin_insert on public.projects
for insert to authenticated
with check (
  private.is_tenant_admin(tenant_id)
  and created_by = (select auth.uid())
);

create policy projects_admin_update on public.projects
for update to authenticated
using (private.is_tenant_admin(tenant_id))
with check (private.is_tenant_admin(tenant_id));

create policy projects_admin_delete on public.projects
for delete to authenticated
using (private.is_tenant_admin(tenant_id));

create policy project_memberships_read_scope on public.project_memberships
for select to authenticated
using (
  private.is_tenant_admin(tenant_id)
  or private.is_project_member(tenant_id, project_id)
);

create policy project_memberships_admin_insert on public.project_memberships
for insert to authenticated
with check (
  private.is_tenant_admin(tenant_id)
  and created_by = (select auth.uid())
);

create policy project_memberships_admin_delete on public.project_memberships
for delete to authenticated
using (private.is_tenant_admin(tenant_id));

create policy profiles_read_shared_internal_scope on public.profiles
for select to authenticated
using (
  private.is_internal_user()
  and tenant_id = private.current_tenant_id()
  and private.shares_internal_membership(tenant_id, id)
);

grant select, insert, update, delete on public.teams to authenticated;
grant select, insert, delete on public.team_memberships to authenticated;
grant select, insert, update, delete on public.projects to authenticated;
grant select, insert, delete on public.project_memberships to authenticated;
