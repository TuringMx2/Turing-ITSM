-- Persist the validated self-registration name without changing tenant or access provisioning.

create or replace function private.provision_self_registered_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_email text;
  v_full_name text;
begin
  if new.email is null or btrim(new.email) = '' then
    raise exception 'Unable to provision self-registered account';
  end if;

  v_full_name := regexp_replace(
    btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')),
    '\s+',
    ' ',
    'g'
  );

  if v_full_name = '' or char_length(v_full_name) > 160 then
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
    v_full_name,
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
