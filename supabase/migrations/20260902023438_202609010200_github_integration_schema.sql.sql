-- Monotoli: GitHub Integration Schema
-- Repositorios, commits, pull requests y actividad diaria agregada.
-- Multitenant + RLS estricto.

create type public.github_pr_state as enum ('open', 'closed', 'merged');

-- -----------------------------------------------------------------------------
-- github_integrations: configuración GitHub por tenant
-- -----------------------------------------------------------------------------
create table public.github_integrations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  installation_id text,
  access_token_encrypted bytea,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_synced_at timestamptz,
  constraint github_integrations_creator_tenant_fk
    foreign key (tenant_id, created_by)
    references public.profiles (tenant_id, id)
    on delete restrict,
  unique (tenant_id, id),
  check (installation_id is null or char_length(btrim(installation_id)) between 1 and 128)
);

-- -----------------------------------------------------------------------------
-- github_repos: repositorios monitoreados
-- -----------------------------------------------------------------------------
create table public.github_repos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  github_integration_id uuid not null,
  repo_full_name text not null,
  default_branch text not null default 'main',
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint github_repos_integration_tenant_fk
    foreign key (tenant_id, github_integration_id)
    references public.github_integrations (tenant_id, id)
    on delete cascade,
  unique (tenant_id, id),
  unique (tenant_id, repo_full_name),
  check (repo_full_name ~ '^[\w.\-]+/[\w.\-]+$' and char_length(repo_full_name) between 3 and 260),
  check (char_length(btrim(default_branch)) between 1 and 255)
);

-- -----------------------------------------------------------------------------
-- github_commits: historial commits normalizado
-- -----------------------------------------------------------------------------
create table public.github_commits (
  sha text not null,
  github_repo_id uuid not null,
  tenant_id uuid not null,
  author_email text,
  author_name text,
  message_head text not null,
  committed_at timestamptz not null,
  additions integer,
  deletions integer,
  branch text,
  created_at timestamptz not null default now(),
  constraint github_commits_repo_tenant_fk
    foreign key (tenant_id, github_repo_id)
    references public.github_repos (tenant_id, id)
    on delete cascade,
  primary key (sha, tenant_id, github_repo_id),
  unique (tenant_id, github_repo_id, sha),
  check (char_length(sha) = 40 or char_length(sha) = 7),
  check (char_length(btrim(message_head)) between 1 and 512),
  check (additions is null or additions >= 0),
  check (deletions is null or deletions >= 0)
);

-- -----------------------------------------------------------------------------
-- github_pull_requests: prs por repo
-- -----------------------------------------------------------------------------
create table public.github_pull_requests (
  github_id bigint not null,
  github_repo_id uuid not null,
  tenant_id uuid not null,
  number integer not null,
  title text not null,
  state public.github_pr_state not null,
  author_login text,
  created_at timestamptz not null,
  merged_at timestamptz,
  closed_at timestamptz,
  additions integer,
  deletions integer,
  updated_at timestamptz not null default now(),
  constraint github_prs_repo_tenant_fk
    foreign key (tenant_id, github_repo_id)
    references public.github_repos (tenant_id, id)
    on delete cascade,
  primary key (github_id, tenant_id),
  unique (tenant_id, github_id),
  unique (tenant_id, github_repo_id, number),
  check (number > 0),
  check (char_length(btrim(title)) between 1 and 1024),
  check (additions is null or additions >= 0),
  check (deletions is null or deletions >= 0)
);

-- -----------------------------------------------------------------------------
-- github_repo_activity_daily: tabla agregada (commits + prs + líneas por día)
-- Útil para gráficos rápidos sin agregar en cada request.
-- -----------------------------------------------------------------------------
create table public.github_repo_activity_daily (
  date date not null,
  github_repo_id uuid not null,
  tenant_id uuid not null,
  commits_count integer not null default 0,
  prs_opened integer not null default 0,
  prs_merged integer not null default 0,
  lines_added bigint not null default 0,
  lines_deleted bigint not null default 0,
  active_authors integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint github_activity_repo_tenant_fk
    foreign key (tenant_id, github_repo_id)
    references public.github_repos (tenant_id, id)
    on delete cascade,
  primary key (tenant_id, github_repo_id, date),
  check (commits_count >= 0),
  check (prs_opened >= 0),
  check (prs_merged >= 0),
  check (lines_added >= 0),
  check (lines_deleted >= 0),
  check (active_authors >= 0)
);

-- -----------------------------------------------------------------------------
-- Triggers updated_at
-- -----------------------------------------------------------------------------
create trigger set_github_integrations_updated_at
before update on public.github_integrations
for each row execute function private.set_updated_at();

create trigger set_github_repos_updated_at
before update on public.github_repos
for each row execute function private.set_updated_at();

create trigger set_github_prs_updated_at
before update on public.github_pull_requests
for each row execute function private.set_updated_at();

create trigger set_github_activity_updated_at
before update on public.github_repo_activity_daily
for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Índices
-- -----------------------------------------------------------------------------
create index github_commits_repo_date_idx on public.github_commits (tenant_id, github_repo_id, committed_at desc);
create index github_commits_author_idx on public.github_commits (tenant_id, author_email nulls last, committed_at desc);
create index github_prs_repo_state_idx on public.github_pull_requests (tenant_id, github_repo_id, state, created_at desc);
create index github_activity_date_idx on public.github_repo_activity_daily (tenant_id, github_repo_id, date asc);

-- -----------------------------------------------------------------------------
-- RLS + Policies
-- -----------------------------------------------------------------------------
alter table public.github_integrations enable row level security;
alter table public.github_repos enable row level security;
alter table public.github_commits enable row level security;
alter table public.github_pull_requests enable row level security;
alter table public.github_repo_activity_daily enable row level security;

create policy github_integrations_read_scope on public.github_integrations
for select to authenticated using (tenant_id = private.current_tenant_id());

create policy github_integrations_admin_all on public.github_integrations
for all to authenticated
using (private.is_tenant_admin(tenant_id))
with check (private.is_tenant_admin(tenant_id));

create policy github_repos_read_scope on public.github_repos
for select to authenticated using (tenant_id = private.current_tenant_id());

create policy github_repos_admin_all on public.github_repos
for all to authenticated
using (private.is_tenant_admin(tenant_id))
with check (private.is_tenant_admin(tenant_id));

create policy github_commits_read_scope on public.github_commits
for select to authenticated using (tenant_id = private.current_tenant_id());

create policy github_commits_admin_all on public.github_commits
for all to authenticated
using (private.is_tenant_admin(tenant_id))
with check (private.is_tenant_admin(tenant_id));

create policy github_prs_read_scope on public.github_pull_requests
for select to authenticated using (tenant_id = private.current_tenant_id());

create policy github_prs_admin_all on public.github_pull_requests
for all to authenticated
using (private.is_tenant_admin(tenant_id))
with check (private.is_tenant_admin(tenant_id));

create policy github_activity_read_scope on public.github_repo_activity_daily
for select to authenticated using (tenant_id = private.current_tenant_id());

create policy github_activity_admin_all on public.github_repo_activity_daily
for all to authenticated
using (private.is_tenant_admin(tenant_id))
with check (private.is_tenant_admin(tenant_id));

grant select, insert, update, delete on public.github_integrations to authenticated;
grant select, insert, update, delete on public.github_repos to authenticated;
grant select, insert, update, delete on public.github_commits to authenticated;
grant select, insert, update, delete on public.github_pull_requests to authenticated;
grant select, insert, update, delete on public.github_repo_activity_daily to authenticated;
;
