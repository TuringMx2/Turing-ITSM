-- Monotoli: Jira Integration Schema
-- Tablas para sincronizar Jira boards, sprints, issues y changelog en Supabase.
-- Multitenant + RLS estricto. FKs compuestos siguiendo patrón 20260825*.

create extension if not exists "pgcrypto";

create type public.jira_sprint_state as enum ('active', 'closed', 'future');
create type public.jira_sync_trigger as enum ('webhook', 'scheduled', 'manual');
create type public.jira_sync_status as enum ('pending', 'running', 'success', 'failed');

-- -----------------------------------------------------------------------------
-- jira_integrations: credenciales y configuración por tenant
-- -----------------------------------------------------------------------------
create table public.jira_integrations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  jira_domain text not null,
  jira_email_encrypted bytea,
  jira_api_token_encrypted bytea,
  default_board_id integer,
  story_points_field text not null default 'customfield_10016',
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_synced_at timestamptz,
  sync_status public.jira_sync_status,
  constraint jira_domain_check check (char_length(btrim(jira_domain)) between 4 and 253),
  constraint jira_story_points_field_check check (char_length(btrim(story_points_field)) between 1 and 80),
  constraint jira_integrations_creator_tenant_fk
    foreign key (tenant_id, created_by)
    references public.profiles (tenant_id, id)
    on delete restrict,
  unique (tenant_id, id),
  unique (tenant_id, jira_domain)
);

-- -----------------------------------------------------------------------------
-- jira_teams: mapeo equipo Turing ↔ integración jira
-- -----------------------------------------------------------------------------
create table public.jira_teams (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  team_id uuid not null,
  jira_integration_id uuid not null,
  jira_domain text not null,
  display_name text,
  created_at timestamptz not null default now(),
  constraint jira_teams_team_tenant_fk
    foreign key (tenant_id, team_id)
    references public.teams (tenant_id, id)
    on delete cascade,
  constraint jira_teams_integration_tenant_fk
    foreign key (tenant_id, jira_integration_id)
    references public.jira_integrations (tenant_id, id)
    on delete cascade,
  unique (tenant_id, id),
  unique (tenant_id, team_id, jira_integration_id)
);

-- -----------------------------------------------------------------------------
-- jira_boards: boards (proyectos) Jira disponibles por integración
-- -----------------------------------------------------------------------------
create table public.jira_boards (
  jira_id integer not null,
  tenant_id uuid not null,
  jira_integration_id uuid not null,
  name text not null,
  type text,
  location_project_key text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint jira_boards_integration_tenant_fk
    foreign key (tenant_id, jira_integration_id)
    references public.jira_integrations (tenant_id, id)
    on delete cascade,
  primary key (jira_id, tenant_id),
  unique (tenant_id, jira_id),
  check (char_length(btrim(name)) between 1 and 255)
);

-- -----------------------------------------------------------------------------
-- jira_sprints: sprints cerrados + activos por board
-- -----------------------------------------------------------------------------
create table public.jira_sprints (
  jira_id integer not null,
  jira_board_id integer not null,
  tenant_id uuid not null,
  name text not null,
  state public.jira_sprint_state not null,
  start_date timestamptz,
  end_date timestamptz,
  complete_date timestamptz,
  goal text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint jira_sprints_board_tenant_fk
    foreign key (jira_board_id, tenant_id)
    references public.jira_boards (jira_id, tenant_id)
    on delete cascade,
  primary key (jira_id, tenant_id),
  unique (tenant_id, jira_id),
  check (char_length(btrim(name)) between 1 and 255)
);

-- -----------------------------------------------------------------------------
-- jira_issues: issues con SP normalizados (misma deduplicación clean_issues)
-- -----------------------------------------------------------------------------
create table public.jira_issues (
  jira_key text not null,
  jira_sprint_id integer not null,
  tenant_id uuid not null,
  summary text not null,
  status text not null,
  issuetype text not null,
  assignee_display_name text,
  assignee_email text,
  story_points numeric(10,2),
  created_at timestamptz not null,
  resolution_date timestamptz,
  resolved boolean not null default false,
  parent_key text,
  raw_fields jsonb,
  last_synced_at timestamptz,
  constraint jira_issues_sprint_tenant_fk
    foreign key (jira_sprint_id, tenant_id)
    references public.jira_sprints (jira_id, tenant_id)
    on delete cascade,
  primary key (jira_key, tenant_id),
  unique (tenant_id, jira_key),
  check (char_length(btrim(jira_key)) between 1 and 64),
  check (char_length(btrim(summary)) between 1 and 1024),
  check (char_length(btrim(status)) between 1 and 128),
  check (char_length(btrim(issuetype)) between 1 and 128),
  check (story_points is null or story_points >= 0)
);

-- -----------------------------------------------------------------------------
-- jira_changelog_entries: transiciones de estado por issue (solo status)
-- -----------------------------------------------------------------------------
create table public.jira_changelog_entries (
  id uuid primary key default gen_random_uuid(),
  jira_issue_key text not null,
  tenant_id uuid not null,
  changed_at timestamptz not null,
  from_status text,
  to_status text,
  jira_author_display_name text,
  created_at timestamptz not null default now(),
  constraint jira_changelog_issue_tenant_fk
    foreign key (jira_issue_key, tenant_id)
    references public.jira_issues (jira_key, tenant_id)
    on delete cascade,
  unique (tenant_id, id)
);
create unique index jira_changelog_uniq_idx on public.jira_changelog_entries
  (tenant_id, jira_issue_key, changed_at, coalesce(from_status, ''), coalesce(to_status, ''));

-- -----------------------------------------------------------------------------
-- jira_sync_runs: bitácora de ejecuciones pipeline
-- -----------------------------------------------------------------------------
create table public.jira_sync_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  jira_integration_id uuid not null,
  trigger_type public.jira_sync_trigger not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status public.jira_sync_status not null default 'pending',
  issues_fetched integer,
  error_message text,
  constraint jira_sync_runs_integration_tenant_fk
    foreign key (tenant_id, jira_integration_id)
    references public.jira_integrations (tenant_id, id)
    on delete cascade,
  unique (tenant_id, id)
);

-- -----------------------------------------------------------------------------
-- Triggers updated_at
-- -----------------------------------------------------------------------------
create trigger set_jira_integrations_updated_at
before update on public.jira_integrations
for each row execute function private.set_updated_at();

create trigger set_jira_boards_updated_at
before update on public.jira_boards
for each row execute function private.set_updated_at();

create trigger set_jira_sprints_updated_at
before update on public.jira_sprints
for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Índices de performance
-- -----------------------------------------------------------------------------
create index jira_boards_tenant_idx on public.jira_boards (tenant_id);
create index jira_sprints_board_tenant_idx on public.jira_sprints (tenant_id, jira_board_id, state);
create index jira_sprints_dates_tenant_idx on public.jira_sprints (tenant_id, start_date nulls last, end_date nulls last);
create index jira_issues_sprint_tenant_idx on public.jira_issues (tenant_id, jira_sprint_id, resolved);
create index jira_issues_assignee_tenant_idx on public.jira_issues (tenant_id, assignee_email nulls last);
create index jira_issues_created_tenant_idx on public.jira_issues (tenant_id, created_at desc);
create index jira_changelog_issue_tenant_idx on public.jira_changelog_entries (tenant_id, jira_issue_key, changed_at asc);
create index jira_changelog_to_status_idx on public.jira_changelog_entries (tenant_id, to_status nulls last, changed_at asc);
create index jira_sync_runs_integration_idx on public.jira_sync_runs (tenant_id, jira_integration_id, started_at desc);

-- -----------------------------------------------------------------------------
-- RLS + Policies
-- -----------------------------------------------------------------------------
alter table public.jira_integrations enable row level security;
alter table public.jira_teams enable row level security;
alter table public.jira_boards enable row level security;
alter table public.jira_sprints enable row level security;
alter table public.jira_issues enable row level security;
alter table public.jira_changelog_entries enable row level security;
alter table public.jira_sync_runs enable row level security;

create policy jira_integrations_read_scope on public.jira_integrations
for select to authenticated
using (tenant_id = private.current_tenant_id());

create policy jira_integrations_admin_insert on public.jira_integrations
for insert to authenticated
with check (private.is_tenant_admin(tenant_id) and (created_by is null or created_by = (select auth.uid())));

create policy jira_integrations_admin_update on public.jira_integrations
for update to authenticated
using (private.is_tenant_admin(tenant_id))
with check (private.is_tenant_admin(tenant_id));

create policy jira_teams_read_scope on public.jira_teams
for select to authenticated
using (tenant_id = private.current_tenant_id() and (private.is_tenant_admin(tenant_id) or private.is_team_member(tenant_id, team_id)));

create policy jira_teams_admin_all on public.jira_teams
for all to authenticated
using (private.is_tenant_admin(tenant_id))
with check (private.is_tenant_admin(tenant_id));

create policy jira_boards_read_scope on public.jira_boards
for select to authenticated
using (tenant_id = private.current_tenant_id());

create policy jira_boards_admin_all on public.jira_boards
for all to authenticated
using (private.is_tenant_admin(tenant_id))
with check (private.is_tenant_admin(tenant_id));

create policy jira_sprints_read_scope on public.jira_sprints
for select to authenticated
using (tenant_id = private.current_tenant_id());

create policy jira_sprints_admin_all on public.jira_sprints
for all to authenticated
using (private.is_tenant_admin(tenant_id))
with check (private.is_tenant_admin(tenant_id));

create policy jira_issues_read_scope on public.jira_issues
for select to authenticated
using (tenant_id = private.current_tenant_id());

create policy jira_issues_admin_all on public.jira_issues
for all to authenticated
using (private.is_tenant_admin(tenant_id))
with check (private.is_tenant_admin(tenant_id));

create policy jira_changelog_read_scope on public.jira_changelog_entries
for select to authenticated
using (tenant_id = private.current_tenant_id());

create policy jira_changelog_admin_all on public.jira_changelog_entries
for all to authenticated
using (private.is_tenant_admin(tenant_id))
with check (private.is_tenant_admin(tenant_id));

create policy jira_sync_runs_read_scope on public.jira_sync_runs
for select to authenticated
using (tenant_id = private.current_tenant_id());

create policy jira_sync_runs_admin_all on public.jira_sync_runs
for all to authenticated
using (private.is_tenant_admin(tenant_id))
with check (private.is_tenant_admin(tenant_id));

-- -----------------------------------------------------------------------------
-- Permisos (grants)
-- -----------------------------------------------------------------------------
grant select, insert, update on public.jira_integrations to authenticated;
grant select, insert, update, delete on public.jira_teams to authenticated;
grant select, insert, update, delete on public.jira_boards to authenticated;
grant select, insert, update, delete on public.jira_sprints to authenticated;
grant select, insert, update, delete on public.jira_issues to authenticated;
grant select, insert, update, delete on public.jira_changelog_entries to authenticated;
grant select, insert, update, delete on public.jira_sync_runs to authenticated;
;
