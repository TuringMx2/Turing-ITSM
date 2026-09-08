-- Monotoli KPI RPC — 2 funciones faltantes para migrar 4 charts Streamlit
-- (A) kpi_sp_stacked_by_member_sprint → Stacked bar de SP asignados por persona × sprint
-- (B) kpi_project_burndown → Burndown del proyecto completo (scope/remaining/ideal a 3 meses)
--
-- Firma patrón V4: p_project_id uuid default null como ÚLTIMO parámetro.
-- Si p_project_id IS NULL → scope global tenant (igual que hoy).
-- Si p_project_id IS NOT NULL → filtra joins.

set search_path = public;

-- =========================================================================
-- DROPS preventivos por si se reejecuta la migración
-- =========================================================================

drop function if exists public.kpi_sp_stacked_by_member_sprint(uuid, integer, uuid);
drop function if exists public.kpi_project_burndown(uuid, integer, text[], uuid);

-- =========================================================================
-- (A) kpi_sp_stacked_by_member_sprint
--     Paridad con helpers.get_sp_per_member_per_sprint()
--     Retorna long format: sprint_jira_id, sprint_name, assignee, sp_assigned
--     para pivotear en cliente como stacked bar.
-- =========================================================================

create or replace function public.kpi_sp_stacked_by_member_sprint(
  p_tenant_id uuid,
  p_board_id integer default null,
  p_project_id uuid default null
)
returns table (
  sprint_jira_id integer,
  sprint_name text,
  sprint_end_date date,
  assignee_display_name text,
  assignee_email text,
  sp_assigned numeric
)
language sql
stable
set search_path = ''
as $$
  with candidate_sprints as (
    select s.jira_id, s.name, s.end_date
    from public.jira_sprints s
    where s.tenant_id = p_tenant_id
      and (p_board_id is null or s.jira_board_id = p_board_id)
      and (p_project_id is null or s.project_id = p_project_id)
    order by s.end_date asc nulls last, s.jira_id asc
  ),
  candidate_issues as (
    select
      i.jira_sprint_id,
      coalesce(i.assignee_display_name, 'Sin asignar') as assignee_display_name,
      coalesce(i.assignee_email, '') as assignee_email,
      coalesce(i.story_points, 0) as sp
    from public.jira_issues i
    where i.tenant_id = p_tenant_id
      and i.issuetype not in ('Sub-task', 'Subtask', 'Epic')
      and (p_project_id is null or i.project_id = p_project_id)
      and i.jira_sprint_id in (select jira_id from candidate_sprints)
  )
  select
    cs.jira_id::integer as sprint_jira_id,
    cs.name as sprint_name,
    cs.end_date::date as sprint_end_date,
    ci.assignee_display_name,
    ci.assignee_email,
    coalesce(sum(ci.sp), 0)::numeric as sp_assigned
  from candidate_sprints cs
  left join candidate_issues ci on ci.jira_sprint_id = cs.jira_id
  group by cs.jira_id, cs.name, cs.end_date, ci.assignee_display_name, ci.assignee_email
  having coalesce(sum(ci.sp), 0) > 0
  order by cs.end_date asc nulls last, cs.jira_id asc, sp_assigned desc;
$$;

-- =========================================================================
-- (B) kpi_project_burndown
--     Paridad con charts/burndown.py::chart_project_burndown()
--     Scope acumulado, remaining, línea ideal hasta el target_date.
--     Default target_months = 3 desde el primer created_at.
-- =========================================================================

create or replace function public.kpi_project_burndown(
  p_tenant_id uuid,
  p_target_months integer default 3,
  p_done_statuses text[] default array['Done', 'Cerrado', 'Listo', 'Closed', 'Completado'],
  p_project_id uuid default null
)
returns table (
  as_of_date date,
  scope numeric,
  completed numeric,
  remaining numeric,
  ideal numeric
)
language sql
stable
set search_path = ''
as $$
  with project_issues as (
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
    where i.tenant_id = p_tenant_id
      and i.issuetype not in ('Sub-task', 'Subtask', 'Epic')
      and (p_project_id is null or i.project_id = p_project_id)
      and i.created_at >= current_date - interval '2 years'
  ),
  project_meta as (
    select
      coalesce(min(created_on), current_date) as project_start,
      coalesce(
        max(case when done_on is not null then done_on else created_on end),
        current_date
      ) as project_end
    from project_issues
  ),
  target_date as (
    select
      (project_start + (p_target_months::text || ' months')::interval)::date as the_target
    from project_meta
  ),
  end_calc as (
    select
      greatest(
        (select the_target from target_date),
        current_date,
        (select project_end from project_meta)
      )::date as end_date,
      (select project_start from project_meta)::date as start_date,
      (select the_target from target_date)::date as target
  ),
  date_range as (
    select d::date as the_date
    from generate_series(
      (select start_date from end_calc),
      (select end_date from end_calc),
      interval '1 day'
    ) d
  ),
  scope_cum as (
    select
      dr.the_date,
      coalesce(sum(i.story_points), 0)::numeric as delta_scope
    from date_range dr
    left join project_issues i on i.created_on = dr.the_date
    group by dr.the_date
  ),
  completed_cum as (
    select
      dr.the_date,
      coalesce(sum(i.story_points), 0)::numeric as delta_done
    from date_range dr
    left join project_issues i on i.done_on = dr.the_date
    group by dr.the_date
  ),
  series as (
    select
      sc.the_date,
      coalesce(sum(sc.delta_scope) over w, 0)::numeric as s_scope,
      coalesce(sum(cc.delta_done) over w, 0)::numeric as s_done,
      (coalesce(sum(sc.delta_scope) over w, 0) - coalesce(sum(cc.delta_done) over w, 0))::numeric as s_remaining
    from scope_cum sc
    join completed_cum cc on cc.the_date = sc.the_date
    window w as (order by sc.the_date rows between unbounded preceding and current row)
    order by sc.the_date
  ),
  ideal_seed as (
    select s.*
    from series s
    where s.s_remaining > 0
    order by s.the_date asc
    limit 1
  ),
  ideal_params as (
    select
      coalesce(is_.the_date, (select min(the_date) from series)) as ideal_start,
      coalesce(is_.s_remaining, (select max(s_remaining) from series)) as start_remaining,
      (select target from end_calc) as ideal_end_date,
      greatest(
        (select target from end_calc)::date - coalesce(is_.the_date, (select min(the_date) from series))::date,
        1
      ) as ideal_days
    from ideal_seed is_
    right join (select 1) t on true
    limit 1
  ),
  ideal_series as (
    select
      s.the_date,
      case
        when s.the_date < ip.ideal_start then null
        when s.the_date > ip.ideal_end_date then 0::numeric
        else
          round(
            ip.start_remaining *
            (1 - (s.the_date::date - ip.ideal_start::date)::numeric / greatest(ip.ideal_days, 1)::numeric),
            2
          )::numeric
      end as ideal_val
    from series s, ideal_params ip
  )
  select
    s.the_date as as_of_date,
    s.s_scope as scope,
    s.s_done as completed,
    s.s_remaining as remaining,
    is_.ideal_val as ideal
  from series s
  join ideal_series is_ on is_.the_date = s.the_date
  order by s.the_date;
$$;

-- =========================================================================
-- GRANTS — match del patrón V4 (sobre la firma COMPLETA con defaults)
-- =========================================================================

revoke execute on function public.kpi_sp_stacked_by_member_sprint(uuid, integer, uuid) from public;
revoke execute on function public.kpi_project_burndown(uuid, integer, text[], uuid) from public;

grant execute on function public.kpi_sp_stacked_by_member_sprint(uuid, integer, uuid) to authenticated, service_role;
grant execute on function public.kpi_project_burndown(uuid, integer, text[], uuid) to authenticated, service_role;
;
