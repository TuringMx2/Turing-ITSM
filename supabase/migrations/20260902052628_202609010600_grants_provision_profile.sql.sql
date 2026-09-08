-- Fix grants para public.provision_profile y bypass role update directo con service_role o superadmin authenticated
-- service_role bypass RLS PERO las functions tambien requieren execute grants.
grant execute on function public.provision_profile(uuid, public.app_role, uuid, text, text) to authenticated, service_role;

-- Alternativa directa: crear una función SECURITY DEFINER (owner postgres) que permita setear role sin restricciones,
-- llamada update_profile_role_unsafe:
create or replace function public.update_profile_role_unsafe(
  p_user_id uuid,
  p_role public.app_role
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.set_config('app.provision_profile', 'true', true);
  update public.profiles
  set role = p_role,
      updated_at = now()
  where id = p_user_id;
end;
$$;
alter function public.update_profile_role_unsafe(uuid, public.app_role) owner to postgres;
revoke all on function public.update_profile_role_unsafe(uuid, public.app_role) from public;
grant execute on function public.update_profile_role_unsafe(uuid, public.app_role) to service_role;
;
