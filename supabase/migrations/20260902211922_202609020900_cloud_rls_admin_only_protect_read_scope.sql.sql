-- Migración 202609020900: Cloud RLS admin-only
-- Alineado con requisito usuario: "Gastos cloud = módulo exclusivo admin para visualizar y editar"
-- Soporte y agentes NO LEEN cloud_cost_entries ni cloud_cost_sources.
-- Requisito admin implica rol 'admin' o 'superadmin' vía helper private.is_tenant_admin(tenant_id).

set search_path = public;

-- =========================================================================
-- cloud_cost_sources
-- =========================================================================
drop policy if exists cloud_cost_sources_read_scope on public.cloud_cost_sources;

create policy cloud_cost_sources_read_scope on public.cloud_cost_sources
  for select to authenticated
  using (private.is_tenant_admin(tenant_id));

-- =========================================================================
-- cloud_cost_entries
-- =========================================================================
drop policy if exists cloud_cost_entries_read_scope on public.cloud_cost_entries;

create policy cloud_cost_entries_read_scope on public.cloud_cost_entries
  for select to authenticated
  using (private.is_tenant_admin(tenant_id));

-- =========================================================================
-- Grant se mantiene (la policy filtra)
-- =========================================================================
-- grant select, insert, update, delete on public.cloud_cost_sources to authenticated;
-- grant select, insert, update, delete on public.cloud_cost_entries to authenticated;
;
