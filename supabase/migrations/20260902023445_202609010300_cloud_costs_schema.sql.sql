-- Monotoli: Cloud Costs Schema
-- Fuentes de datos (Google Sheets) y registros de gastos por servicio/fecha.
-- Multitenant + RLS estricto.

-- -----------------------------------------------------------------------------
-- cloud_cost_sources: configuración de fuente Google Sheets
-- -----------------------------------------------------------------------------
create table public.cloud_cost_sources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  spreadsheet_id text not null,
  sheet_name text not null default 'Expenses',
  sync_frequency_hours integer not null default 24,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_synced_at timestamptz,
  constraint cloud_cost_sources_creator_tenant_fk
    foreign key (tenant_id, created_by)
    references public.profiles (tenant_id, id)
    on delete restrict,
  unique (tenant_id, id),
  unique (tenant_id, spreadsheet_id, sheet_name),
  check (char_length(btrim(spreadsheet_id)) between 8 and 255),
  check (char_length(btrim(sheet_name)) between 1 and 255),
  check (sync_frequency_hours between 1 and 720)
);

-- -----------------------------------------------------------------------------
-- cloud_cost_entries: gastos cloud por servicio + fecha
-- -----------------------------------------------------------------------------
create table public.cloud_cost_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  date date not null,
  service_name text not null,
  provider_name text,
  cost_usd numeric(14,4) not null default 0,
  cost_mxn numeric(14,4),
  source_sheet_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cloud_cost_entries_source_tenant_fk
    foreign key (tenant_id, source_sheet_id)
    references public.cloud_cost_sources (tenant_id, id)
    on delete cascade,
  unique (tenant_id, id),
  unique (tenant_id, source_sheet_id, date, service_name),
  check (char_length(btrim(service_name)) between 1 and 255),
  check (provider_name is null or char_length(btrim(provider_name)) between 1 and 255),
  check (cost_usd >= 0),
  check (cost_mxn is null or cost_mxn >= 0)
);

-- -----------------------------------------------------------------------------
-- Triggers updated_at
-- -----------------------------------------------------------------------------
create trigger set_cloud_cost_sources_updated_at
before update on public.cloud_cost_sources
for each row execute function private.set_updated_at();

create trigger set_cloud_cost_entries_updated_at
before update on public.cloud_cost_entries
for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Índices
-- -----------------------------------------------------------------------------
create index cloud_cost_entries_date_idx on public.cloud_cost_entries (tenant_id, date desc);
create index cloud_cost_entries_service_idx on public.cloud_cost_entries (tenant_id, service_name, date asc);
create index cloud_cost_entries_provider_idx on public.cloud_cost_entries (tenant_id, provider_name nulls last, date asc);

-- -----------------------------------------------------------------------------
-- RLS + Policies
-- -----------------------------------------------------------------------------
alter table public.cloud_cost_sources enable row level security;
alter table public.cloud_cost_entries enable row level security;

create policy cloud_cost_sources_read_scope on public.cloud_cost_sources
for select to authenticated using (tenant_id = private.current_tenant_id());

create policy cloud_cost_sources_admin_all on public.cloud_cost_sources
for all to authenticated
using (private.is_tenant_admin(tenant_id))
with check (private.is_tenant_admin(tenant_id));

create policy cloud_cost_entries_read_scope on public.cloud_cost_entries
for select to authenticated using (tenant_id = private.current_tenant_id());

create policy cloud_cost_entries_admin_all on public.cloud_cost_entries
for all to authenticated
using (private.is_tenant_admin(tenant_id))
with check (private.is_tenant_admin(tenant_id));

grant select, insert, update, delete on public.cloud_cost_sources to authenticated;
grant select, insert, update, delete on public.cloud_cost_entries to authenticated;
;
