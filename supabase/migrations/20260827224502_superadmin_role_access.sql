-- Add the tenant-scoped superadmin role. It keeps admin's effective permission
-- set while receiving the complete internal workspace navigation.

insert into public.role_permissions (role, permission_key)
select 'superadmin'::public.app_role, rp.permission_key
from public.role_permissions rp
where rp.role = 'admin'
on conflict (role, permission_key) do nothing;

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
    and private.current_role() in ('admin', 'superadmin')
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
    and private.current_role() in ('support_agent', 'admin', 'superadmin')
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
        when 'superadmin' then t.tenant_id = private.current_tenant_id()
        else false
      end
      from public.tickets t
      where t.id = p_ticket_id
    ),
    false
  )
$$;

create or replace function private.prepare_ticket()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_prefix text;
  v_creator_role public.app_role;
  v_creator_tenant uuid;
  v_agent_role public.app_role;
begin
  if new.ticket_number is null or btrim(new.ticket_number) = '' then
    select upper(substr(md5(coalesce(nullif(t.slug, ''), 'TT')), 1, 6))
      into v_prefix
    from public.tenants t
    where t.id = new.tenant_id;

    new.ticket_number := coalesce(v_prefix, 'TT0000')
      || '-'
      || lpad(nextval('public.ticket_number_seq')::text, 6, '0');
  end if;

  if new.created_by_user_id is not null then
    select p.role, p.tenant_id into v_creator_role, v_creator_tenant
    from public.profiles p where p.id = new.created_by_user_id;

    if v_creator_role in ('customer_user', 'customer_manager')
       and v_creator_tenant is distinct from new.tenant_id then
      raise exception 'tickets.created_by_user_id must belong to the ticket tenant';
    end if;
  end if;

  if new.assigned_agent_id is not null then
    select p.role into v_agent_role
    from public.profiles p where p.id = new.assigned_agent_id;

    if v_agent_role not in ('support_agent', 'admin', 'superadmin') then
      raise exception 'tickets.assigned_agent_id must reference an internal user';
    end if;
  end if;

  return new;
end;
$$;

create or replace function private.assert_internal_membership()
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
  if v_role not in ('support_agent', 'admin', 'superadmin') then
    raise exception 'Team and project memberships require an internal user';
  end if;
  return new;
end;
$$;

create or replace function private.prevent_member_role_demotion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.role in ('support_agent', 'admin', 'superadmin')
     and new.role not in ('support_agent', 'admin', 'superadmin')
     and (
       exists (select 1 from public.team_memberships tm where tm.user_id = old.id)
       or exists (select 1 from public.project_memberships pm where pm.user_id = old.id)
     ) then
    raise exception 'Remove team and project memberships before changing to a customer role';
  end if;
  return new;
end;
$$;

create or replace function private.prevent_last_active_admin_change()
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
    v_lifecycle_change := new.role not in ('admin', 'superadmin')
      or new.status is distinct from 'active';
  end if;

  if old.tenant_id is not null
     and old.role in ('admin', 'superadmin')
     and old.status = 'active'
     and v_lifecycle_change then
    perform 1 from public.tenants where id = old.tenant_id for update;
    select count(*) into v_remaining_admins
    from public.profiles p
    where p.tenant_id = old.tenant_id
      and p.id <> old.id
      and p.role in ('admin', 'superadmin')
      and p.status = 'active';

    if v_remaining_admins = 0 then
      raise exception 'A tenant must retain at least one active administrator';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

alter function private.is_tenant_admin(uuid) owner to postgres;
alter function private.is_internal_user() owner to postgres;
alter function private.can_read_ticket(uuid) owner to postgres;
alter function private.prepare_ticket() owner to postgres;
alter function private.assert_internal_membership() owner to postgres;
alter function private.prevent_member_role_demotion() owner to postgres;
alter function private.prevent_last_active_admin_change() owner to postgres;

drop policy if exists tickets_insert_scope on public.tickets;
create policy tickets_insert_scope on public.tickets
for insert to authenticated
with check (
  (
    private.current_role() in ('customer_user', 'customer_manager')
    and tenant_id = private.current_tenant_id()
    and created_by_user_id = (select auth.uid())
    and status = 'new'
    and assigned_agent_id is null
  )
  or (
    private.is_internal_user()
    and tenant_id = private.current_tenant_id()
    and created_by_user_id = (select auth.uid())
  )
);;
