-- Migración 202609010800: Segmentación por proyectos
-- Objetivo: Conectar todas las integraciones (Jira, GitHub, Cloud, Daily) al modelo
-- organizacional `projects` existente (projects.id uuid PK), mediante:
--   (a) tablas puente (fuente de verdad manual administrador),
--   (b) columna project_id uuid NULLABLE en cada tabla de datos + FK ON DELETE SET NULL,
--   (c) triggers BEFORE INSERT / UPDATE que autollenan project_id denormalizado desde el
--       registro padre (ej: jira_issues.project_id = jira_sprints.project_id),
--   (d) índices compuestos (tenant_id, project_id, ... campos de filtro habituales),
--   (e) RLS policies nuevas OR is_project_member para vistas restringidas por proyecto.
--
-- Restricción: TODAS LAS NUEVAS COLUMNAS = NULLABLE. Nada de romper el status quo.
--              Default behavior (sin seleccionar proyecto) = igual que hoy.

set search_path = public;

-- =========================================================================
-- 1) TABLAS PUENTE (administradores linkean manualmente; fuente de verdad)
-- =========================================================================

create table if not exists public.project_jira_boards (
  tenant_id uuid not null,
  project_id uuid not null,
  jira_board_id integer not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, project_id, jira_board_id),
  constraint pjb_project_tenant_fk
    foreign key (tenant_id, project_id)
    references public.projects (tenant_id, id)
    on delete cascade,
  constraint pjb_board_tenant_fk
    foreign key (jira_board_id, tenant_id)
    references public.jira_boards (jira_id, tenant_id)
    on delete cascade,
  constraint pjb_creator_tenant_fk
    foreign key (tenant_id, created_by)
    references public.profiles (tenant_id, id)
    on delete restrict
);

create table if not exists public.project_github_repos (
  tenant_id uuid not null,
  project_id uuid not null,
  github_repo_id uuid not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, project_id, github_repo_id),
  constraint pgr_project_tenant_fk
    foreign key (tenant_id, project_id)
    references public.projects (tenant_id, id)
    on delete cascade,
  constraint pgr_repo_tenant_fk
    foreign key (tenant_id, github_repo_id)
    references public.github_repos (tenant_id, id)
    on delete cascade,
  constraint pgr_creator_tenant_fk
    foreign key (tenant_id, created_by)
    references public.profiles (tenant_id, id)
    on delete restrict
);

create table if not exists public.project_cloud_tag_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  service_pattern text not null default '%',
  provider_pattern text,
  use_regex boolean not null default false,
  match_order integer not null default 100,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint pct_project_tenant_fk
    foreign key (tenant_id, project_id)
    references public.projects (tenant_id, id)
    on delete cascade,
  constraint pct_creator_tenant_fk
    foreign key (tenant_id, created_by)
    references public.profiles (tenant_id, id)
    on delete restrict,
  constraint pct_match_order_check check (match_order between 1 and 1000000)
);

-- UNIQUE sobre columns con provider_pattern nullable: índice único expresional (no inline constraint)
create unique index if not exists pct_uniq_rules_idx
  on public.project_cloud_tag_rules (tenant_id, project_id, service_pattern, coalesce(provider_pattern, ''::text));

create table if not exists public.project_daily_team_links (
  tenant_id uuid not null,
  project_id uuid not null,
  team_id uuid not null,
  priority_weight numeric(5,2) not null default 1.00,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, project_id, team_id),
  constraint pdt_project_tenant_fk
    foreign key (tenant_id, project_id)
    references public.projects (tenant_id, id)
    on delete cascade,
  constraint pdt_team_tenant_fk
    foreign key (tenant_id, team_id)
    references public.teams (tenant_id, id)
    on delete cascade,
  constraint pdt_creator_tenant_fk
    foreign key (tenant_id, created_by)
    references public.profiles (tenant_id, id)
    on delete restrict,
  constraint pdt_weight_check check (priority_weight between 0 and 100)
);

-- =========================================================================
-- 2) COLUMNAS project_id uuid NULLABLE + FK
-- =========================================================================

do $$
begin
  -- jira_boards
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='jira_boards' and column_name='project_id') then
    alter table public.jira_boards add column project_id uuid
      references public.projects (id) on delete set null;
  end if;

  -- jira_sprints
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='jira_sprints' and column_name='project_id') then
    alter table public.jira_sprints add column project_id uuid
      references public.projects (id) on delete set null;
  end if;

  -- jira_issues
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='jira_issues' and column_name='project_id') then
    alter table public.jira_issues add column project_id uuid
      references public.projects (id) on delete set null;
  end if;

  -- jira_changelog_entries
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='jira_changelog_entries' and column_name='project_id') then
    alter table public.jira_changelog_entries add column project_id uuid
      references public.projects (id) on delete set null;
  end if;

  -- github_repos
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='github_repos' and column_name='project_id') then
    alter table public.github_repos add column project_id uuid
      references public.projects (id) on delete set null;
  end if;

  -- github_commits
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='github_commits' and column_name='project_id') then
    alter table public.github_commits add column project_id uuid
      references public.projects (id) on delete set null;
  end if;

  -- github_repo_activity_daily
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='github_repo_activity_daily' and column_name='project_id') then
    alter table public.github_repo_activity_daily add column project_id uuid
      references public.projects (id) on delete set null;
  end if;

  -- github_pull_requests
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='github_pull_requests' and column_name='project_id') then
    alter table public.github_pull_requests add column project_id uuid
      references public.projects (id) on delete set null;
  end if;

  -- cloud_cost_entries
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='cloud_cost_entries' and column_name='project_id') then
    alter table public.cloud_cost_entries add column project_id uuid
      references public.projects (id) on delete set null;
  end if;

  -- daily_runs
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='daily_runs' and column_name='project_id') then
    alter table public.daily_runs add column project_id uuid
      references public.projects (id) on delete set null;
  end if;
end $$;

-- =========================================================================
-- 3) TRIGGERS populate denormalizado desde registro padre (herencia)
-- =========================================================================

create or replace function private.propagate_project_id_from_board_to_sprints()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    select b.project_id into new.project_id
      from public.jira_boards b
      where b.jira_id = new.jira_board_id and b.tenant_id = new.tenant_id
      limit 1;
  elsif tg_op = 'UPDATE' then
    if new.jira_board_id is distinct from old.jira_board_id then
      select b.project_id into new.project_id
        from public.jira_boards b
        where b.jira_id = new.jira_board_id and b.tenant_id = new.tenant_id
        limit 1;
    end if;
  end if;
  return new;
end $$;

create or replace function private.propagate_project_id_from_sprint_to_issue()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    select s.project_id into new.project_id
      from public.jira_sprints s
      where s.jira_id = new.jira_sprint_id and s.tenant_id = new.tenant_id
      limit 1;
  elsif tg_op = 'UPDATE' then
    if new.jira_sprint_id is distinct from old.jira_sprint_id then
      select s.project_id into new.project_id
        from public.jira_sprints s
        where s.jira_id = new.jira_sprint_id and s.tenant_id = new.tenant_id
        limit 1;
    end if;
  end if;
  return new;
end $$;

create or replace function private.propagate_project_id_from_issue_to_changelog()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    select i.project_id into new.project_id
      from public.jira_issues i
      where i.jira_key = new.jira_issue_key and i.tenant_id = new.tenant_id
      limit 1;
  elsif tg_op = 'UPDATE' then
    if new.jira_issue_key is distinct from old.jira_issue_key then
      select i.project_id into new.project_id
        from public.jira_issues i
        where i.jira_key = new.jira_issue_key and i.tenant_id = new.tenant_id
        limit 1;
    end if;
  end if;
  return new;
end $$;

create or replace function private.propagate_project_id_from_repo_to_commits()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    select r.project_id into new.project_id
      from public.github_repos r
      where r.id = new.github_repo_id and r.tenant_id = new.tenant_id
      limit 1;
  elsif tg_op = 'UPDATE' then
    if new.github_repo_id is distinct from old.github_repo_id then
      select r.project_id into new.project_id
        from public.github_repos r
        where r.id = new.github_repo_id and r.tenant_id = new.tenant_id
        limit 1;
    end if;
  end if;
  return new;
end $$;

create or replace function private.propagate_project_id_from_repo_to_activity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    select r.project_id into new.project_id
      from public.github_repos r
      where r.id = new.github_repo_id and r.tenant_id = new.tenant_id
      limit 1;
  elsif tg_op = 'UPDATE' then
    if new.github_repo_id is distinct from old.github_repo_id then
      select r.project_id into new.project_id
        from public.github_repos r
        where r.id = new.github_repo_id and r.tenant_id = new.tenant_id
        limit 1;
    end if;
  end if;
  return new;
end $$;

create or replace function private.propagate_project_id_from_repo_to_prs()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    select r.project_id into new.project_id
      from public.github_repos r
      where r.id = new.github_repo_id and r.tenant_id = new.tenant_id
      limit 1;
  elsif tg_op = 'UPDATE' then
    if new.github_repo_id is distinct from old.github_repo_id then
      select r.project_id into new.project_id
        from public.github_repos r
        where r.id = new.github_repo_id and r.tenant_id = new.tenant_id
        limit 1;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists b_i_u_sprints_project_id on public.jira_sprints;
create trigger b_i_u_sprints_project_id
before insert or update on public.jira_sprints
for each row execute function private.propagate_project_id_from_board_to_sprints();

drop trigger if exists b_i_u_issues_project_id on public.jira_issues;
create trigger b_i_u_issues_project_id
before insert or update on public.jira_issues
for each row execute function private.propagate_project_id_from_sprint_to_issue();

drop trigger if exists b_i_u_changelog_project_id on public.jira_changelog_entries;
create trigger b_i_u_changelog_project_id
before insert or update on public.jira_changelog_entries
for each row execute function private.propagate_project_id_from_issue_to_changelog();

drop trigger if exists b_i_u_commits_project_id on public.github_commits;
create trigger b_i_u_commits_project_id
before insert or update on public.github_commits
for each row execute function private.propagate_project_id_from_repo_to_commits();

drop trigger if exists b_i_u_activity_project_id on public.github_repo_activity_daily;
create trigger b_i_u_activity_project_id
before insert or update on public.github_repo_activity_daily
for each row execute function private.propagate_project_id_from_repo_to_activity();

drop trigger if exists b_i_u_prs_project_id on public.github_pull_requests;
create trigger b_i_u_prs_project_id
before insert or update on public.github_pull_requests
for each row execute function private.propagate_project_id_from_repo_to_prs();

alter function private.propagate_project_id_from_board_to_sprints() owner to postgres;
alter function private.propagate_project_id_from_sprint_to_issue() owner to postgres;
alter function private.propagate_project_id_from_issue_to_changelog() owner to postgres;
alter function private.propagate_project_id_from_repo_to_commits() owner to postgres;
alter function private.propagate_project_id_from_repo_to_activity() owner to postgres;
alter function private.propagate_project_id_from_repo_to_prs() owner to postgres;

revoke all on function private.propagate_project_id_from_board_to_sprints() from public;
revoke all on function private.propagate_project_id_from_sprint_to_issue() from public;
revoke all on function private.propagate_project_id_from_issue_to_changelog() from public;
revoke all on function private.propagate_project_id_from_repo_to_commits() from public;
revoke all on function private.propagate_project_id_from_repo_to_activity() from public;
revoke all on function private.propagate_project_id_from_repo_to_prs() from public;

-- =========================================================================
-- 4) ÍNDICES COMPUESTOS (tenant_id, project_id, ... campos más consultados)
-- =========================================================================

create index if not exists pj_boards_tpid_idx on public.jira_boards (tenant_id, project_id, jira_id);
create index if not exists pj_sprints_tpid_idx on public.jira_sprints (tenant_id, project_id, jira_id, state);
create index if not exists pj_issues_tpid_idx on public.jira_issues (tenant_id, project_id, jira_sprint_id, resolved);
create index if not exists pj_changelog_tpid_idx on public.jira_changelog_entries (tenant_id, project_id, jira_issue_key, changed_at);

create index if not exists p_github_repos_tpid_idx on public.github_repos (tenant_id, project_id, id);
create index if not exists p_github_commits_tpid_idx on public.github_commits (tenant_id, project_id, committed_at desc);
create index if not exists p_github_activity_tpid_idx on public.github_repo_activity_daily (tenant_id, project_id, date desc);
create index if not exists p_github_prs_tpid_idx on public.github_pull_requests (tenant_id, project_id, created_at desc);

create index if not exists p_cloud_entries_tpid_idx on public.cloud_cost_entries (tenant_id, project_id, date desc, service_name);

create index if not exists p_daily_runs_tpid_idx on public.daily_runs (tenant_id, project_id, local_date desc);

-- Índices para tablas puente (queries frecuentes JOIN por tenant + project)
create index if not exists pjb_board_idx on public.project_jira_boards (tenant_id, jira_board_id) include (project_id);
create index if not exists pgr_repo_idx on public.project_github_repos (tenant_id, github_repo_id) include (project_id);
create index if not exists pct_rules_order_idx on public.project_cloud_tag_rules (tenant_id, match_order asc);
create index if not exists pdt_team_idx on public.project_daily_team_links (tenant_id, team_id) include (project_id, priority_weight);

-- =========================================================================
-- 5) RLS ENABLE + POLICIES NUEVAS para tablas puente + ajustes policies integraciones
-- =========================================================================

alter table public.project_jira_boards enable row level security;
alter table public.project_github_repos enable row level security;
alter table public.project_cloud_tag_rules enable row level security;
alter table public.project_daily_team_links enable row level security;

-- Todas las tablas puente: lectura para admins y project members. Escritura admin only.
create policy pjb_read_scope on public.project_jira_boards
for select to authenticated
using (
  private.is_tenant_admin(tenant_id)
  or private.is_project_member(tenant_id, project_id)
);

create policy pjb_admin_write on public.project_jira_boards
for insert to authenticated
with check (
  private.is_tenant_admin(tenant_id)
  and created_by = (select auth.uid())
);

create policy pjb_admin_delete on public.project_jira_boards
for delete to authenticated
using (private.is_tenant_admin(tenant_id));

create policy pgr_read_scope on public.project_github_repos
for select to authenticated
using (
  private.is_tenant_admin(tenant_id)
  or private.is_project_member(tenant_id, project_id)
);

create policy pgr_admin_write on public.project_github_repos
for insert to authenticated
with check (
  private.is_tenant_admin(tenant_id)
  and created_by = (select auth.uid())
);

create policy pgr_admin_delete on public.project_github_repos
for delete to authenticated
using (private.is_tenant_admin(tenant_id));

create policy pct_read_scope on public.project_cloud_tag_rules
for select to authenticated
using (
  private.is_tenant_admin(tenant_id)
  or private.is_project_member(tenant_id, project_id)
);

create policy pct_admin_write on public.project_cloud_tag_rules
for insert to authenticated
with check (
  private.is_tenant_admin(tenant_id)
  and created_by = (select auth.uid())
);

create policy pct_admin_update on public.project_cloud_tag_rules
for update to authenticated
using (private.is_tenant_admin(tenant_id))
with check (private.is_tenant_admin(tenant_id));

create policy pct_admin_delete on public.project_cloud_tag_rules
for delete to authenticated
using (private.is_tenant_admin(tenant_id));

create policy pdt_read_scope on public.project_daily_team_links
for select to authenticated
using (
  private.is_tenant_admin(tenant_id)
  or private.is_project_member(tenant_id, project_id)
);

create policy pdt_admin_write on public.project_daily_team_links
for insert to authenticated
with check (
  private.is_tenant_admin(tenant_id)
  and created_by = (select auth.uid())
);

create policy pdt_admin_delete on public.project_daily_team_links
for delete to authenticated
using (private.is_tenant_admin(tenant_id));

-- Ajuste policies integraciones (ya son por tenant): agregar is_project_member cuando
-- project_id IS NOT NULL. Si project_id es NULL (aún no segmentado) → mantiene scope actual.
-- Para no romper scopes existentes (ya tienen OR is_tenant_admin / integration scopes),
-- agregamos policies auxiliares "is_project_member extension" vía duplicado de policy
-- con OR. En PostgreSQL policies se combinan OR entre sí.

-- Para mantenerlo simple y no entrar a REPLACE de policies ya existentes (dado que
-- `private.is_tenant_admin` ya habilita acceso al admin) basta con otorgar permiso
-- project member en los casos donde la política NO cubre (solo integration scoped user).
-- No hacemos cambios a policies ya existentes en esta migración — el filtrado real
-- lo hace la columna project_id en las queries/RPC. La consistencia de acceso por
-- project_id se garantiza a nivel de server actions (Frontend) y de WHERE en las
-- RPC KPI v4 de la migración 0810.

-- =========================================================================
-- 6) GRANTS (authenticated/service_role) para tablas puente
-- =========================================================================

grant select, insert, delete on public.project_jira_boards to authenticated;
grant select, insert, delete on public.project_github_repos to authenticated;
grant select, insert, update, delete on public.project_cloud_tag_rules to authenticated;
grant select, insert, delete on public.project_daily_team_links to authenticated;

grant select, insert, update, delete on public.project_jira_boards to service_role;
grant select, insert, update, delete on public.project_github_repos to service_role;
grant select, insert, update, delete on public.project_cloud_tag_rules to service_role;
grant select, insert, update, delete on public.project_daily_team_links to service_role;

-- =========================================================================
-- 7) POPULATE INICIAL (backfill) project_id denormalizado por herencia
--    Trigger solo corre en INSERT/UPDATE; para data existente ejecutamos UPDATEs
--    con JOIN al padre (no-op si NULLs, no rompe nada).
-- =========================================================================

-- jira_sprints hereda de jira_boards
update public.jira_sprints s
  set project_id = b.project_id
  from public.jira_boards b
  where b.jira_id = s.jira_board_id
    and b.tenant_id = s.tenant_id
    and s.project_id is null
    and b.project_id is not null;

-- jira_issues hereda de jira_sprints
update public.jira_issues i
  set project_id = s.project_id
  from public.jira_sprints s
  where s.jira_id = i.jira_sprint_id
    and s.tenant_id = i.tenant_id
    and i.project_id is null
    and s.project_id is not null;

-- jira_changelog_entries hereda de jira_issues
update public.jira_changelog_entries c
  set project_id = i.project_id
  from public.jira_issues i
  where i.jira_key = c.jira_issue_key
    and i.tenant_id = c.tenant_id
    and c.project_id is null
    and i.project_id is not null;

-- github_commits hereda de github_repos
update public.github_commits c
  set project_id = r.project_id
  from public.github_repos r
  where r.id = c.github_repo_id
    and r.tenant_id = c.tenant_id
    and c.project_id is null
    and r.project_id is not null;

-- github_repo_activity_daily hereda de github_repos
update public.github_repo_activity_daily a
  set project_id = r.project_id
  from public.github_repos r
  where r.id = a.github_repo_id
    and r.tenant_id = a.tenant_id
    and a.project_id is null
    and r.project_id is not null;

-- github_pull_requests hereda de github_repos
update public.github_pull_requests p
  set project_id = r.project_id
  from public.github_repos r
  where r.id = p.github_repo_id
    and r.tenant_id = p.tenant_id
    and p.project_id is null
    and r.project_id is not null;
;
