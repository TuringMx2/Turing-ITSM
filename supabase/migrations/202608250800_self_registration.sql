-- Provision self-registered Auth users as active support agents in the active
-- Turing ITSM tenant. The trigger deliberately does not trust user metadata.

create function private.provision_self_registered_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_email text;
begin
  if new.email is null or btrim(new.email) = '' then
    raise exception 'Unable to provision self-registered account';
  end if;

  -- STRICT makes both a missing target and an ambiguous target fail closed.
  select t.id
    into strict v_tenant_id
  from public.tenants t
  where t.status = 'active'
    and (
      t.slug = 'turing-itsm'
      or lower(btrim(t.name)) = 'turing itsm'
    );

  v_email := btrim(new.email);

  insert into public.profiles (
    id,
    tenant_id,
    role,
    full_name,
    email,
    status
  ) values (
    new.id,
    v_tenant_id,
    'support_agent'::public.app_role,
    left(v_email, 160),
    v_email,
    'active'
  );

  return new;
exception
  when no_data_found or too_many_rows then
    raise exception 'Unable to provision self-registered account';
end;
$$;

alter function private.provision_self_registered_profile() owner to postgres;
revoke all on function private.provision_self_registered_profile() from public, anon, authenticated, service_role;

drop trigger if exists on_auth_user_created_self_registration on auth.users;
create trigger on_auth_user_created_self_registration
after insert on auth.users
for each row execute function private.provision_self_registered_profile();
