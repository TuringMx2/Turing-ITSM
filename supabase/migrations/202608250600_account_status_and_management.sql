-- Internal account lifecycle controls. Inactive profiles cannot authenticate to or
-- access the application, while dependent records remain available for recovery.

alter table public.profiles
  add column status text not null default 'active',
  add constraint profiles_status_check check (status in ('active', 'inactive'));

create index profiles_tenant_status_role_idx
  on public.profiles (tenant_id, status, role);

create or replace function private.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.status = 'active'
  )
$$;

create or replace function private.current_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles p
  where p.id = (select auth.uid())
    and p.status = 'active'
$$;

create or replace function private.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.tenant_id
  from public.profiles p
  where p.id = (select auth.uid())
    and p.status = 'active'
$$;

create or replace function private.is_tenant_admin(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    p_tenant_id is not null
    and private.is_active_user()
    and private.current_role() = 'admin'
    and private.current_tenant_id() = p_tenant_id,
    false
  )
$$;

create or replace function private.is_internal_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    private.is_active_user()
    and private.current_role() in ('support_agent', 'admin')
    and private.current_tenant_id() is not null,
    false
  )
$$;

create or replace function private.can_read_ticket(p_ticket_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    private.is_active_user()
    and (
      select case private.current_role()
        when 'customer_user' then
          t.tenant_id = private.current_tenant_id()
          and (
            t.created_by_user_id = (select auth.uid())
            or exists (
              select 1 from public.reporters r
              where r.id = t.reporter_id and r.profile_id = (select auth.uid())
            )
          )
        when 'customer_manager' then t.tenant_id = private.current_tenant_id()
        when 'support_agent' then t.tenant_id = private.current_tenant_id()
        when 'admin' then t.tenant_id = private.current_tenant_id()
        else false
      end
      from public.tickets t
      where t.id = p_ticket_id
    ),
    false
  )
$$;

create or replace function private.is_team_member(p_tenant_id uuid, p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_user()
    and exists (
      select 1
      from public.team_memberships tm
      where tm.tenant_id = p_tenant_id
        and tm.team_id = p_team_id
        and tm.user_id = (select auth.uid())
        and p_tenant_id = private.current_tenant_id()
    )
$$;

create or replace function private.is_project_member(p_tenant_id uuid, p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_user()
    and exists (
      select 1
      from public.project_memberships pm
      where pm.tenant_id = p_tenant_id
        and pm.project_id = p_project_id
        and pm.user_id = (select auth.uid())
        and p_tenant_id = private.current_tenant_id()
    )
$$;

create or replace function private.can_manage_project(p_tenant_id uuid, p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_user()
    and (
      private.is_tenant_admin(p_tenant_id)
      or private.is_project_member(p_tenant_id, p_project_id)
    )
$$;

create or replace function private.shares_internal_membership(
  p_tenant_id uuid,
  p_other_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_user()
    and p_tenant_id = private.current_tenant_id()
    and (
      exists (
        select 1
        from public.team_memberships mine
        join public.team_memberships theirs on theirs.team_id = mine.team_id
        where mine.user_id = (select auth.uid())
          and mine.tenant_id = p_tenant_id
          and theirs.tenant_id = p_tenant_id
          and theirs.user_id = p_other_user_id
      )
      or exists (
        select 1
        from public.project_memberships mine
        join public.project_memberships theirs on theirs.project_id = mine.project_id
        where mine.user_id = (select auth.uid())
          and mine.tenant_id = p_tenant_id
          and theirs.tenant_id = p_tenant_id
          and theirs.user_id = p_other_user_id
      )
    )
$$;

create or replace function private.assert_internal_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.app_role;
  v_status text;
begin
  select p.role, p.status into v_role, v_status
  from public.profiles p
  where p.id = new.user_id and p.tenant_id = new.tenant_id;
  if v_role not in ('support_agent', 'admin') or v_status <> 'active' then
    raise exception 'Team and project memberships require an active internal user';
  end if;
  return new;
end;
$$;

create function private.prevent_last_active_admin_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_remaining_admins integer;
  v_lifecycle_change boolean := false;
begin
  if tg_op = 'UPDATE'
     and new.id = (select auth.uid())
     and new.status = 'inactive' then
    raise exception 'A user cannot deactivate their own account';
  end if;

  if tg_op = 'DELETE' then
    v_lifecycle_change := true;
  elsif tg_op = 'UPDATE' then
    v_lifecycle_change := new.role is distinct from 'admin'
      or new.status is distinct from 'active';
  end if;

  if old.tenant_id is not null
     and old.role = 'admin'
     and old.status = 'active'
     and v_lifecycle_change then
    -- Serialize every admin lifecycle change for this tenant before counting.
    perform 1 from public.tenants where id = old.tenant_id for update;
    select count(*) into v_remaining_admins
    from public.profiles p
    where p.tenant_id = old.tenant_id
      and p.id <> old.id
      and p.role = 'admin'
      and p.status = 'active';

    if v_remaining_admins = 0 then
      raise exception 'A tenant must retain at least one active admin';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

alter function private.is_active_user() owner to postgres;
alter function private.current_role() owner to postgres;
alter function private.current_tenant_id() owner to postgres;
alter function private.is_tenant_admin(uuid) owner to postgres;
alter function private.is_internal_user() owner to postgres;
alter function private.can_read_ticket(uuid) owner to postgres;
alter function private.is_team_member(uuid, uuid) owner to postgres;
alter function private.is_project_member(uuid, uuid) owner to postgres;
alter function private.can_manage_project(uuid, uuid) owner to postgres;
alter function private.shares_internal_membership(uuid, uuid) owner to postgres;
alter function private.assert_internal_membership() owner to postgres;
alter function private.prevent_last_active_admin_change() owner to postgres;

revoke all on function private.is_active_user() from public;
revoke execute on function private.assert_internal_membership() from public;
revoke execute on function private.prevent_last_active_admin_change() from public;
grant execute on function private.is_active_user() to authenticated;

drop policy profiles_read_scope on public.profiles;
create policy profiles_read_scope on public.profiles
for select to authenticated
using (
  private.is_active_user()
  and (
    id = (select auth.uid())
    or private.is_tenant_admin(tenant_id)
    or (
      private.current_role() = 'customer_manager'
      and tenant_id = private.current_tenant_id()
    )
    or (
      private.current_role() = 'support_agent'
      and exists (
        select 1
        from public.tickets t
        where private.can_read_ticket(t.id)
          and (t.created_by_user_id = profiles.id or t.assigned_agent_id = profiles.id)
      )
    )
  )
);

drop policy permissions_authenticated_read on public.permissions;
create policy permissions_authenticated_read on public.permissions
for select to authenticated using (private.is_active_user());

drop policy role_permissions_authenticated_read on public.role_permissions;
create policy role_permissions_authenticated_read on public.role_permissions
for select to authenticated using (private.is_active_user());

drop policy channels_authenticated_read on public.channels;
create policy channels_authenticated_read on public.channels
for select to authenticated
using (private.is_active_user() and (is_active or private.is_tenant_admin(private.current_tenant_id())));

create trigger prevent_last_active_admin_change
before update of role, status or delete on public.profiles
for each row execute function private.prevent_last_active_admin_change();

grant select, insert, update on public.profiles to authenticated;
