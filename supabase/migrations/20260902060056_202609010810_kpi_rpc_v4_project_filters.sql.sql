-- Monotoli KPI RPC v4 — FILTRO POR PROYECTO
-- Extensión de v3: agrega `p_project_id uuid default null` como ÚLTIMO parámetro
-- en TODAS las 6 RPC. Si p_project_id is null → COMPORTAMIENTO IGUAL QUE HOY (global tenant).
-- Si p_project_id is not null → filtra joins a tablas denormalizadas project_id.
-- Nombre de columnas alias RETORNADAS: IDÉNTICO que v3 para no romper types TS.

set search_path = public;

-- =========================================================================
-- DROPS Limpieza de todas las combinaciones v3 (firmas exactas)
-- =========================================================================

drop function if exists public.kpi_sprint_burndown(uuid, integer, text[]);
drop function if exists public.kpi_sprint_burndown(uuid, integer);
drop function if exists public.kpi_velocity_summary(uuid, integer, integer, text[]);
drop function if exists public.kpi_velocity_summary(uuid, integer, integer);
drop function if exists public.kpi_assigned_sp_by_member(uuid, integer, integer);
drop function if exists public.kpi_assigned_sp_by_member(uuid, integer);
drop function if exists public.kpi_sp_completed_over_time(uuid, integer, text, date, date);
drop function if exists public.kpi_sp_completed_over_time(uuid, integer, text);
drop function if exists public.kpi_sp_completed_over_time(uuid, text, date, date);
drop function if exists public.kpi_cloud_costs_pivot(uuid, text, text, date, date);
drop function if exists public.kpi_daily_annotations_for_sprint(uuid, uuid, date, date);
drop function if exists public.kpi_daily_annotations_for_sprint(uuid, uuid, integer);

-- =========================================================================
-- 1) kpi_sprint_burndown (sprint + filtro project por issues/changelog)
-- =========================================================================

create or replace function public.kpi_sprint_burndown(
  p_tenant_id uuid,
  p_sprint_id integer,
  p_done_statuses text[] default array['Done', 'Cerrado', 'Listo', 'Closed', 'Completado'],
  p_project_id uuid default null
)
returns table (
  as_of_date date,
  scope numeric,
  completed numeric,
  remaining numeric
)
language sql
stable
set search_path = ''
as $$
  with sprint_meta as (
    select
      coalesce(s.start_date::date, (min(i.created_at) over ())::date) as sprint_start,
      coalesce(
        case when s.state = 'closed' then s.complete_date::date else s.end_date::date end,
        (max(i.created_at) over ())::date,
        current_date
      ) as sprint_end
    from public.jira_sprints s
    left join public.jira_issues i
      on i.tenant_id = p_tenant_id and i.jira_sprint_id = s.jira_id
      and (p_project_id is null or i.project_id = p_project_id)
    where s.tenant_id = p_tenant_id and s.jira_id = p_sprint_id
      and (p_project_id is null or s.project_id = p_project_id)
    limit 1
  ),
  sprint_issues as (
    select
      i.jira_key,
      i.story_points,
      i.created_at::date as created_on,
      case
        when i.resolved then coalesce(i.resolution_date::date, current_date)
        else (
          select min(c.changed_at::date)
          from public.jira_changelog_entries c
          where c.tenant_id = p_tenant_id
            and c.jira_issue_key = i.jira_key
            and c.to_status = any(p_done_statuses)
            and (p_project_id is null or c.project_id = p_project_id)
        )
      end as done_on
    from public.jira_issues i
    where i.tenant_id = p_tenant_id and i.jira_sprint_id = p_sprint_id
      and i.issuetype not in ('Sub-task', 'Subtask', 'Epic')
      and (p_project_id is null or i.project_id = p_project_id)
  ),
  date_range as (
    select d::date as the_date
    from generate_series(
      (select sprint_start from sprint_meta),
      greatest((select sprint_end from sprint_meta), current_date),
      interval '1 day'
    ) d
  ),
  scope_cum as (
    select dr.the_date, coalesce(sum(i.story_points), 0) as delta_scope
    from date_range dr
    left join sprint_issues i on i.created_on = dr.the_date
    group by dr.the_date
  ),
  completed_cum as (
    select dr.the_date, coalesce(sum(i.story_points), 0) as delta_done
    from date_range dr
    left join sprint_issues i on i.done_on = dr.the_date
    group by dr.the_date
  )
  select
    sc.the_date,
    coalesce(sum(sc.delta_scope) over w, 0)::numeric as scope,
    coalesce(sum(cc.delta_done) over w, 0)::numeric as completed,
    (coalesce(sum(sc.delta_scope) over w, 0) - coalesce(sum(cc.delta_done) over w, 0))::numeric as remaining
  from scope_cum sc
  join completed_cum cc on cc.the_date = sc.the_date
  window w as (order by sc.the_date rows between unbounded preceding and current row)
  order by sc.the_date;
$$;

-- =========================================================================
-- 2) kpi_velocity_summary
-- =========================================================================

create or replace function public.kpi_velocity_summary(
  p_tenant_id uuid,
  p_board_id integer default null,
  p_last_n_sprints integer default 6,
  p_done_statuses text[] default array['Done', 'Cerrado', 'Listo', 'Closed', 'Completado'],
  p_project_id uuid default null
)
returns table (
  sprints_count bigint,
  avg_sp_completed numeric,
  total_sp_completed numeric,
  latest_sprint_id integer,
  latest_sprint_name text
)
language sql
stable
set search_path = ''
as $$
  with closed_sprints as (
    select s.jira_id, s.name, s.end_date, s.complete_date
    from public.jira_sprints s
    where s.tenant_id = p_tenant_id
      and s.state = 'closed'
      and (p_board_id is null or s.jira_board_id = p_board_id)
      and (p_project_id is null or s.project_id = p_project_id)
    order by s.complete_date desc nulls last, s.end_date desc nulls last
    limit greatest(p_last_n_sprints, 1)
  ),
  sprint_sp as (
    select
      cs.jira_id,
      cs.name,
      cs.end_date,
      cs.complete_date,
      coalesce(sum(i.story_points) filter (where i.resolved), 0)::numeric as done_sp
    from closed_sprints cs
    left join public.jira_issues i
      on i.tenant_id = p_tenant_id and i.jira_sprint_id = cs.jira_id
      and i.issuetype not in ('Sub-task', 'Subtask', 'Epic')
      and (p_project_id is null or i.project_id = p_project_id)
    group by cs.jira_id, cs.name, cs.end_date, cs.complete_date
  ),
  latest as (
    select jira_id as latest_sprint_id, name as latest_sprint_name
    from sprint_sp
    order by coalesce(complete_date, end_date) desc nulls last
    limit 1
  )
  select
    (select count(*) from sprint_sp)::bigint as sprints_count,
    coalesce(round((avg(done_sp) over ())::numeric, 2), 0) as avg_sp_completed,
    coalesce(sum(done_sp) over (), 0)::numeric as total_sp_completed,
    (select latest_sprint_id from latest) as latest_sprint_id,
    (select latest_sprint_name from latest) as latest_sprint_name
  from sprint_sp
  limit 1;
$$;

-- =========================================================================
-- 3) kpi_assigned_sp_by_member
-- =========================================================================

create or replace function public.kpi_assigned_sp_by_member(
  p_tenant_id uuid,
  p_sprint_id integer default null,
  p_project_id uuid default null
)
returns table (
  assignee_email text,
  assignee_display_name text,
  assigned_sp numeric,
  completed_sp numeric,
  pct_of_total_sp numeric
)
language sql
stable
set search_path = ''
as $$
  with candidate_issues as (
    select i.*
    from public.jira_issues i
    where i.tenant_id = p_tenant_id
      and i.issuetype not in ('Sub-task', 'Subtask', 'Epic')
      and (p_sprint_id is null or i.jira_sprint_id = p_sprint_id)
      and (p_project_id is null or i.project_id = p_project_id)
  ),
  totals as (
    select coalesce(sum(coalesce(story_points, 0)), 0)::numeric as all_sp
    from candidate_issues
  ),
  by_member as (
    select
      coalesce(i.assignee_display_name, 'Sin asignar') as assignee_display_name,
      coalesce(i.assignee_email, '') as assignee_email,
      coalesce(sum(coalesce(i.story_points, 0)), 0)::numeric as assigned_sp,
      coalesce(sum(coalesce(i.story_points, 0)) filter (where i.resolved), 0)::numeric as completed_sp
    from candidate_issues i
    group by coalesce(i.assignee_display_name, 'Sin asignar'), coalesce(i.assignee_email, '')
  )
  select
    bm.assignee_email,
    bm.assignee_display_name,
    bm.assigned_sp,
    bm.completed_sp,
    round(case when t.all_sp = 0 then 0 else (bm.assigned_sp / t.all_sp) * 100 end, 2) as pct_of_total_sp
  from by_member bm
  cross join totals t
  order by bm.assigned_sp desc;
$$;

-- =========================================================================
-- 4) kpi_sp_completed_over_time
-- =========================================================================

create or replace function public.kpi_sp_completed_over_time(
  p_tenant_id uuid,
  p_granularity text default 'W',
  p_from_date date default null,
  p_to_date date default null,
  p_project_id uuid default null
)
returns table (
  bucket text,
  completed_sp numeric,
  completed_issues bigint
)
language sql
stable
set search_path = ''
as $$
  with resolved as (
    select
      coalesce(i.resolution_date::date, current_date) as done_date,
      coalesce(i.story_points, 0) as sp,
      1 as cnt
    from public.jira_issues i
    join public.jira_sprints s
      on s.tenant_id = p_tenant_id and s.jira_id = i.jira_sprint_id
      and (p_project_id is null or s.project_id = p_project_id)
    where i.tenant_id = p_tenant_id
      and i.resolved
      and i.issuetype not in ('Sub-task', 'Subtask', 'Epic')
      and i.resolution_date is not null
      and (p_project_id is null or i.project_id = p_project_id)
      and (p_from_date is null or i.resolution_date::date >= p_from_date)
      and (p_to_date is null or i.resolution_date::date <= p_to_date)
  ),
  bucketed as (
    select
      case upper(p_granularity)
        when 'D' then date_trunc('day', done_date)::date
        when 'W' then date_trunc('week', done_date)::date
        else date_trunc('month', done_date)::date
      end as bucket_start,
      sp,
      cnt
    from resolved
  )
  select
    bucket_start::text as bucket,
    coalesce(sum(sp), 0)::numeric as completed_sp,
    coalesce(sum(cnt), 0)::bigint as completed_issues
  from bucketed
  group by bucket_start
  order by bucket_start asc;
$$;

-- =========================================================================
-- 5) kpi_cloud_costs_pivot
-- =========================================================================

create or replace function public.kpi_cloud_costs_pivot(
  p_tenant_id uuid,
  p_granularity text default 'M',
  p_currency text default 'USD',
  p_from_date date default null,
  p_to_date date default null,
  p_project_id uuid default null
)
returns table (
  bucket text,
  service_name text,
  provider_name text,
  cost_usd numeric,
  cost_mxn numeric
)
language sql
stable
set search_path = ''
as $$
  with filtered as (
    select e.*
    from public.cloud_cost_entries e
    where e.tenant_id = p_tenant_id
      and (p_project_id is null or e.project_id = p_project_id)
      and (p_from_date is null or e.date >= p_from_date)
      and (p_to_date is null or e.date <= p_to_date)
  ),
  bucketed as (
    select
      case upper(p_granularity)
        when 'D' then date_trunc('day', f.date)::date
        when 'W' then date_trunc('week', f.date)::date
        else date_trunc('month', f.date)::date
      end::text as bucket,
      f.service_name,
      f.provider_name,
      coalesce(f.cost_usd, 0) as cost_usd,
      coalesce(f.cost_mxn, 0) as cost_mxn
    from filtered f
  )
  select
    b.bucket,
    b.service_name,
    b.provider_name,
    round(sum(b.cost_usd), 2) as cost_usd,
    round(sum(b.cost_mxn), 2) as cost_mxn
  from bucketed b
  group by b.bucket, b.service_name, b.provider_name
  order by b.bucket asc, b.service_name asc;
$$;

-- =========================================================================
-- 6) kpi_daily_annotations_for_sprint (filtro project_id via team links o directo)
-- =========================================================================

create or replace function public.kpi_daily_annotations_for_sprint(
  p_tenant_id uuid,
  p_team_id uuid default null,
  p_sprint_id integer default null,
  p_project_id uuid default null
)
returns table (
  team_name text,
  user_id uuid,
  full_name text,
  local_date date,
  submission_id uuid,
  answers jsonb
)
language sql
stable
set search_path = ''
as $$
  with project_scoped_teams as (
    select distinct l.team_id
      from public.project_daily_team_links l
     where l.tenant_id = p_tenant_id
       and p_project_id is not null
       and l.project_id = p_project_id
  ),
  sprint_window as (
    select
      coalesce(min(s.start_date::date), current_date - 14) as win_start,
      coalesce(max(case when s.state = 'closed' then s.complete_date::date else s.end_date::date end), current_date) as win_end
    from public.jira_sprints s
    where s.tenant_id = p_tenant_id
      and (p_sprint_id is null or s.jira_id = p_sprint_id)
      and (p_project_id is null or s.project_id = p_project_id)
  )
  select
    coalesce(t.name, 'Equipo sin nombre') as team_name,
    p.id as user_id,
    coalesce(p.full_name, p.email) as full_name,
    r.local_date,
    s.id as submission_id,
    jsonb_agg(
      jsonb_build_object(
        'question_text', a.question_text,
        'answer_text', a.answer_text
      )
      order by a.created_at asc
    ) as answers
  from public.daily_runs r
  join sprint_window w on r.local_date between w.win_start and w.win_end
  left join public.teams t on t.id = r.team_id and t.tenant_id = p_tenant_id
  join public.daily_submission_runs sr
    on sr.tenant_id = p_tenant_id and sr.run_id = r.id
  join public.daily_submissions s
    on s.tenant_id = p_tenant_id and s.id = sr.submission_id and s.user_id = sr.user_id
  join public.daily_submission_answers a
    on a.tenant_id = p_tenant_id and a.submission_id = s.id
  join public.profiles p
    on p.tenant_id = p_tenant_id and p.id = s.user_id
  where r.tenant_id = p_tenant_id
    and (p_team_id is null or r.team_id = p_team_id)
    and (
      p_project_id is null
      or r.project_id = p_project_id
      or r.team_id in (select team_id from project_scoped_teams)
    )
  group by t.name, p.id, coalesce(p.full_name, p.email), r.local_date, s.id
  order by r.local_date asc, full_name asc;
$$;

-- =========================================================================
-- GRANTS (una sola firma por RPC, la completa de v4 con p_project_id default null).
-- En Postgres, si una function tiene DEFAULT params, el permiso EXECUTE sobre la
-- firma COMPLETA (incluyendo el último uuid) es suficiente para llamadas que
-- omiten el último argumento (no hace falta grant por firma truncada).
-- =========================================================================

grant execute on function public.kpi_sprint_burndown(uuid, integer, text[], uuid) to authenticated, service_role;
grant execute on function public.kpi_velocity_summary(uuid, integer, integer, text[], uuid) to authenticated, service_role;
grant execute on function public.kpi_assigned_sp_by_member(uuid, integer, uuid) to authenticated, service_role;
grant execute on function public.kpi_sp_completed_over_time(uuid, text, date, date, uuid) to authenticated, service_role;
grant execute on function public.kpi_cloud_costs_pivot(uuid, text, text, date, date, uuid) to authenticated, service_role;
grant execute on function public.kpi_daily_annotations_for_sprint(uuid, uuid, integer, uuid) to authenticated, service_role;
;
