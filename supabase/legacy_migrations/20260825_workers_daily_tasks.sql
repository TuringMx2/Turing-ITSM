-- Workers daily tasks: projects, project_members, daily_checkins, tasks
-- SDD change workers-daily-tasks (T1). Single migration per design section 9.
-- Idempotent guards mirror initial migrations; safe to re-run locally.

create extension if not exists "pgcrypto";

-- Enums -----------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'task_status') then
    create type public.task_status as enum ('todo','doing','done','blocked');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'task_priority') then
    create type public.task_priority as enum ('low','medium','high','urgent');
  end if;
end $$;

-- Tables ----------------------------------------------------------------------
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 100),
  description text check (description is null or char_length(description) <= 1000),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  archived_at timestamptz null
);

create table if not exists public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create table if not exists public.daily_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  q1_yesterday text not null check (char_length(q1_yesterday) between 1 and 1000),
  q2_today text not null check (char_length(q2_today) between 1 and 1000),
  q3_blockers text null check (q3_blockers is null or char_length(q3_blockers) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, date)
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  description text null check (description is null or char_length(description) <= 2000),
  status public.task_status not null default 'todo',
  priority public.task_priority not null default 'medium',
  assignee_id uuid null references auth.users(id) on delete set null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes ---------------------------------------------------------------------
create index if not exists idx_tasks_project_status on public.tasks(project_id, status);
create index if not exists idx_tasks_assignee on public.tasks(assignee_id);
create index if not exists idx_tasks_created_by on public.tasks(created_by);
create index if not exists idx_daily_user_date on public.daily_checkins(user_id, date desc);
create index if not exists idx_project_members_user on public.project_members(user_id);
create index if not exists idx_project_members_project on public.project_members(project_id);
create index if not exists idx_projects_created_by on public.projects(created_by);

-- Triggers: updated_at --------------------------------------------------------
-- re-use public.set_updated_at() from initial migration; create if missing
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'set_projects_updated_at') then
    create trigger set_projects_updated_at
    before update on public.projects
    for each row execute function public.set_updated_at();
  end if;
end $$;

-- projects uses created_at only; no updated_at column, so trigger not needed.
-- Keep guard above for potential future column; daily_checkins and tasks have updated_at.

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'set_daily_checkins_updated_at') then
    create trigger set_daily_checkins_updated_at
    before update on public.daily_checkins
    for each row execute function public.set_updated_at();
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'set_tasks_updated_at') then
    create trigger set_tasks_updated_at
    before update on public.tasks
    for each row execute function public.set_updated_at();
  end if;
end $$;

-- RLS -------------------------------------------------------------------------
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.daily_checkins enable row level security;
alter table public.tasks enable row level security;

-- is_admin() already exists from initial migration (20260806). No re-definition needed.

do $$
begin
  -- projects ---------------------------------------------------------------
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='projects' and policyname='projects_select_scoped') then
    create policy projects_select_scoped on public.projects
      for select to authenticated
      using (
        public.is_admin()
        or exists (select 1 from public.project_members pm where pm.project_id = projects.id and pm.user_id = auth.uid())
      );
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='projects' and policyname='projects_insert_admin') then
    create policy projects_insert_admin on public.projects
      for insert to authenticated
      with check (public.is_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='projects' and policyname='projects_update_admin') then
    create policy projects_update_admin on public.projects
      for update to authenticated
      using (public.is_admin())
      with check (public.is_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='projects' and policyname='projects_delete_admin') then
    create policy projects_delete_admin on public.projects
      for delete to authenticated
      using (public.is_admin());
  end if;

  -- project_members --------------------------------------------------------
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='project_members' and policyname='project_members_select_scoped') then
    create policy project_members_select_scoped on public.project_members
      for select to authenticated
      using (public.is_admin() or user_id = auth.uid());
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='project_members' and policyname='project_members_insert_admin') then
    create policy project_members_insert_admin on public.project_members
      for insert to authenticated
      with check (public.is_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='project_members' and policyname='project_members_delete_admin') then
    create policy project_members_delete_admin on public.project_members
      for delete to authenticated
      using (public.is_admin());
  end if;

  -- daily_checkins ---------------------------------------------------------
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='daily_checkins' and policyname='daily_checkins_insert_own') then
    create policy daily_checkins_insert_own on public.daily_checkins
      for insert to authenticated
      with check (auth.uid() = user_id);
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='daily_checkins' and policyname='daily_checkins_select_own_or_admin') then
    create policy daily_checkins_select_own_or_admin on public.daily_checkins
      for select to authenticated
      using (user_id = auth.uid() or public.is_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='daily_checkins' and policyname='daily_checkins_update_own_today') then
    create policy daily_checkins_update_own_today on public.daily_checkins
      for update to authenticated
      using (user_id = auth.uid() and date = (now() at time zone 'UTC')::date)
      with check (user_id = auth.uid() and date = (now() at time zone 'UTC')::date);
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='daily_checkins' and policyname='daily_checkins_delete_admin') then
    create policy daily_checkins_delete_admin on public.daily_checkins
      for delete to authenticated
      using (public.is_admin());
  end if;

  -- tasks ------------------------------------------------------------------
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='tasks' and policyname='tasks_select_scoped') then
    create policy tasks_select_scoped on public.tasks
      for select to authenticated
      using (
        public.is_admin()
        or project_id in (select project_id from public.project_members where user_id = auth.uid())
      );
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='tasks' and policyname='tasks_insert_member') then
    create policy tasks_insert_member on public.tasks
      for insert to authenticated
      with check (
        public.is_admin()
        or project_id in (select project_id from public.project_members where user_id = auth.uid())
      );
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='tasks' and policyname='tasks_update_member') then
    create policy tasks_update_member on public.tasks
      for update to authenticated
      using (
        public.is_admin()
        or project_id in (select project_id from public.project_members where user_id = auth.uid())
      )
      with check (
        public.is_admin()
        or project_id in (select project_id from public.project_members where user_id = auth.uid())
      );
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='tasks' and policyname='tasks_delete_admin') then
    create policy tasks_delete_admin on public.tasks
      for delete to authenticated
      using (public.is_admin());
  end if;
end $$;
