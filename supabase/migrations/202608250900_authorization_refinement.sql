-- Refine internal role assignment so superadmin grants are tenant-scoped and
-- ordinary admin role changes use the controlled provisioning RPC.

create or replace function private.is_tenant_superadmin(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    p_tenant_id is not null
    and private.is_active_user()
    and private.current_role() = 'superadmin'
    and private.current_tenant_id() = p_tenant_id,
    false
  )
$$;

create or replace function public.provision_profile(
  p_user_id uuid,
  p_role public.app_role,
  p_tenant_id uuid,
  p_full_name text,
  p_email text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_tenant_admin(p_tenant_id) then
    raise exception 'Only an admin for the target tenant may provision profiles';
  end if;

  if p_role = 'superadmin' and not private.is_tenant_superadmin(p_tenant_id) then
    raise exception 'Only an active superadmin for the target tenant may assign the superadmin role';
  end if;

  if exists (
    select 1 from public.profiles p
    where p.id = p_user_id and p.tenant_id is distinct from p_tenant_id
  ) then
    raise exception 'A profile cannot be moved between tenants by provisioning';
  end if;

  -- This marker is set only inside this validated provisioning path. The
  -- profile trigger rejects direct authenticated role updates.
  perform pg_catalog.set_config('app.provision_profile', 'true', true);

  insert into public.profiles (id, tenant_id, role, full_name, email)
  values (p_user_id, p_tenant_id, p_role, p_full_name, p_email)
  on conflict (id) do update set
    tenant_id = excluded.tenant_id,
    role = excluded.role,
    full_name = excluded.full_name,
    email = excluded.email;
end;
$$;

create or replace function private.prevent_unauthorized_superadmin_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role = 'superadmin'
     and pg_catalog.current_setting('app.provision_profile', true) is distinct from 'true'
     and not private.is_tenant_superadmin(new.tenant_id) then
    raise exception 'Only an active superadmin for the target tenant may assign the superadmin role';
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
     and new.role is distinct from old.role
     and pg_catalog.current_setting('app.provision_profile', true) is distinct from 'true'
     and not private.is_tenant_superadmin(old.tenant_id) then
    raise exception 'Direct profile role updates require an active superadmin';
  end if;

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
    -- Serialize every administrator-equivalent lifecycle change for this tenant.
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

alter function private.is_tenant_superadmin(uuid) owner to postgres;
alter function public.provision_profile(uuid, public.app_role, uuid, text, text) owner to postgres;
alter function private.prevent_unauthorized_superadmin_assignment() owner to postgres;
alter function private.prevent_last_active_admin_change() owner to postgres;

revoke all on function private.is_tenant_superadmin(uuid) from public, anon, authenticated, service_role;
revoke all on function private.prevent_unauthorized_superadmin_assignment() from public, anon, authenticated, service_role;
revoke all on function public.provision_profile(uuid, public.app_role, uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function private.is_tenant_superadmin(uuid) to authenticated;
grant execute on function public.provision_profile(uuid, public.app_role, uuid, text, text) to authenticated;

drop policy profiles_admin_insert on public.profiles;
create policy profiles_admin_insert on public.profiles
for insert to authenticated
with check (
  private.is_tenant_admin(tenant_id)
  and (role <> 'superadmin' or private.is_tenant_superadmin(tenant_id))
);

drop trigger if exists prevent_unauthorized_superadmin_assignment on public.profiles;
create trigger prevent_unauthorized_superadmin_assignment
before insert or update of role on public.profiles
for each row execute function private.prevent_unauthorized_superadmin_assignment();
