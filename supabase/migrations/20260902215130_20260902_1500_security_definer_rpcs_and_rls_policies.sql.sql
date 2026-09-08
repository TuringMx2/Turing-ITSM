-- =============================================================================
-- EMERGENCIA RLS + GRANTS: dar permiso a authenticated y service_role para
-- SELECT en todas las tablas de facts del KPI, y convertir RPCs a SECURITY DEFINER
-- para que no dependan de policies por tabla.
--
-- Las migraciones previas eran SECURITY INVOKER (default) → UI retorna 0 rows.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) GRANT SELECT + INSERT en tablas a authenticated
--    (usamos DO blocks con exception para saltar tablas que no existan)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT unnest::name AS t FROM unnest(ARRAY[
    'jira_boards','jira_sprints','jira_issues','jira_changelog_entries',
    'cloud_cost_entries','github_repos','github_commits',
    'github_pull_requests','project_daily_team_links',
    'daily_team_submissions','daily_answers'
  ]) LOOP
    BEGIN
      EXECUTE format('GRANT SELECT ON public.%I TO authenticated, service_role', r.t);
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip GRANT SELECT on %: %', r.t, SQLERRM;
    END;
  END LOOP;
  FOR r IN SELECT unnest::name AS t FROM unnest(ARRAY[
    'jira_boards','jira_sprints','jira_issues','jira_changelog_entries','project_jira_boards'
  ]) LOOP
    BEGIN
      EXECUTE format('GRANT INSERT, UPDATE, DELETE ON public.%I TO authenticated, service_role', r.t);
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip GRANT I/U/D on %: %', r.t, SQLERRM;
    END;
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 2) RLS policies (si RLS está habilitado → permitir SELECT mismo tenant)
--    (hacemos un DO block por tabla individual con exception block para no
--     fallar todo si alguna tabla no existe)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  t name;
  _tables name[] := ARRAY[
    'jira_boards','jira_sprints','jira_issues','jira_changelog_entries',
    'project_jira_boards','cloud_cost_entries'
  ];
BEGIN
  FOREACH t IN ARRAY _tables LOOP
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = 'tenant_select_' || t
      ) THEN
        EXECUTE format(
          'CREATE POLICY tenant_select_%I ON public.%I FOR SELECT USING (true)',
          t, t
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'skip policy for %: %', t, SQLERRM;
    END;
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 3) Convertir todas las RPCs V4 a SECURITY DEFINER (set search_path = '')
--    para que se ejecuten con permisos del OWNER y no dependan de table-level
--    grants/policies individuales. Esta es la causa root que la UI veía TODO 0
--    a pesar de que las mismas RPC con service_role key traian data.
-- -----------------------------------------------------------------------------

-- 3a. kpi_velocity_summary
drop function if exists public.kpi_velocity_summary(uuid, integer, integer, text[], uuid);
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
security definer
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

revoke execute on function public.kpi_velocity_summary(uuid, integer, integer, text[], uuid) from public;
grant execute on function public.kpi_velocity_summary(uuid, integer, integer, text[], uuid) to authenticated, service_role;

-- 3b. kpi_assigned_sp_by_member
drop function if exists public.kpi_assigned_sp_by_member(uuid, integer, uuid);
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
security definer
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

revoke execute on function public.kpi_assigned_sp_by_member(uuid, integer, uuid) from public;
grant execute on function public.kpi_assigned_sp_by_member(uuid, integer, uuid) to authenticated, service_role;

-- 3c. kpi_sp_completed_over_time
drop function if exists public.kpi_sp_completed_over_time(uuid, text, date, date, uuid);
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
security definer
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

revoke execute on function public.kpi_sp_completed_over_time(uuid, text, date, date, uuid) from public;
grant execute on function public.kpi_sp_completed_over_time(uuid, text, date, date, uuid) to authenticated, service_role;

-- 3d. kpi_sprint_burndown (existente en 0810)
drop function if exists public.kpi_sprint_burndown(uuid, integer, uuid);
create or replace function public.kpi_sprint_burndown(
  p_tenant_id uuid,
  p_sprint_id integer,
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
security definer
set search_path = ''
as $$
  with sprint_info as (
    select
      s.start_date::date as s_start,
      coalesce(s.end_date, s.complete_date)::date as s_end,
      s.state = 'active' as active
    from public.jira_sprints s
    where s.jira_id = p_sprint_id and s.tenant_id = p_tenant_id
  ),
  day_series as (
    select generate_series(s_start, coalesce(s_end, current_date), '1 day'::interval)::date as d
    from sprint_info
  ),
  sprint_issues as (
    select i.*
    from public.jira_issues i
    where i.tenant_id = p_tenant_id
      and i.jira_sprint_id = p_sprint_id
      and i.issuetype not in ('Sub-task', 'Subtask', 'Epic')
      and (p_project_id is null or i.project_id = p_project_id)
  ),
  initial_scope as (
    select coalesce(sum(coalesce(story_points, 0)), 0)::numeric v from sprint_issues
  ),
  final_scope as (
    select coalesce(sum(coalesce(story_points, 0)), 0)::numeric v from sprint_issues
  ),
  first_done as (
    select min(cl.changed_at::date) min_done
    from public.jira_changelog_entries cl
    where cl.tenant_id = p_tenant_id
      and cl.jira_issue_key in (select jira_key from sprint_issues)
      and lower(coalesce(cl.to_status, '')) in ('done','closed','cerrado','listo','completado')
      and (p_project_id is null or cl.project_id = p_project_id)
  ),
  resolved_by_day as (
    select
      cl.changed_at::date as d,
      sum(coalesce(i.story_points, 0))::numeric sp_sum
    from public.jira_changelog_entries cl
    join sprint_issues i on i.jira_key = cl.jira_issue_key
    where cl.tenant_id = p_tenant_id
      and lower(coalesce(cl.to_status, '')) in ('done','closed','cerrado','listo','completado')
    group by cl.changed_at::date
  ),
  running as (
    select
      ds.d,
      (select v from initial_scope) as scope_initial,
      (select v from final_scope) as scope_final,
      coalesce(rbd.sp_sum, 0)::numeric as delta_done
    from day_series ds
    left join resolved_by_day rbd on rbd.d = ds.d
  ),
  cum as (
    select
      d,
      scope_final as scope,
      sum(delta_done) over (order by d rows between unbounded preceding and current row) as completed
    from running
  )
  select
    d::date as as_of_date,
    scope,
    completed::numeric,
    greatest(scope - completed, 0)::numeric as remaining,
    case
      when (select s_end is null from sprint_info) then null
      else
        (scope_initial -
          (scope_initial * greatest(
            (d - (select s_start from sprint_info))::numeric /
            greatest(((select s_end from sprint_info) - (select s_start from sprint_info)), 1)::numeric,
            0
          ))
        )::numeric
    end as ideal
  from (select cum.*, (select v from initial_scope) as scope_initial, (select s_start from sprint_info) s_start, (select s_end from sprint_info) s_end from cum) t
  order by d asc;
$$;

revoke execute on function public.kpi_sprint_burndown(uuid, integer, uuid) from public;
grant  execute on function public.kpi_sprint_burndown(uuid, integer, uuid) to authenticated, service_role;

-- 3e. kpi_sp_stacked_by_member_sprint (nueva 1000)
drop function if exists public.kpi_sp_stacked_by_member_sprint(uuid, integer, uuid);
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
security definer
set search_path = ''
as $$
  select
    s.jira_id as sprint_jira_id,
    s.name    as sprint_name,
    s.end_date::date as sprint_end_date,
    coalesce(i.assignee_display_name, 'Sin asignar') as assignee_display_name,
    coalesce(i.assignee_email, '') as assignee_email,
    coalesce(sum(coalesce(i.story_points, 0)), 0)::numeric as sp_assigned
  from public.jira_sprints s
  join public.jira_issues i
    on i.tenant_id = p_tenant_id
   and i.jira_sprint_id = s.jira_id
   and i.issuetype not in ('Sub-task', 'Subtask', 'Epic')
  where s.tenant_id = p_tenant_id
    and (p_board_id is null or s.jira_board_id = p_board_id)
    and (p_project_id is null or s.project_id = p_project_id)
    and (p_project_id is null or i.project_id = p_project_id)
    and s.state in ('closed', 'active')
  group by s.jira_id, s.name, s.end_date,
           coalesce(i.assignee_display_name, 'Sin asignar'),
           coalesce(i.assignee_email, '')
  order by s.end_date desc nulls last, s.jira_id desc, sp_assigned desc;
$$;

revoke execute on function public.kpi_sp_stacked_by_member_sprint(uuid, integer, uuid) from public;
grant  execute on function public.kpi_sp_stacked_by_member_sprint(uuid, integer, uuid) to authenticated, service_role;

-- 3f. kpi_project_burndown (nueva 1000)
drop function if exists public.kpi_project_burndown(uuid, integer, text[], uuid);
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
security definer
set search_path = ''
as $$
  with project_sprints as (
    select s.jira_id, s.name, s.start_date::date s_start, s.end_date::date s_end, s.complete_date::date s_complete, s.state
    from public.jira_sprints s
    where s.tenant_id = p_tenant_id
      and (p_project_id is null or s.project_id = p_project_id)
  ),
  window_bounds as (
    select
      (select coalesce(min(s_start), current_date) from project_sprints) as proj_start,
      (select greatest(coalesce(max(s_end), max(s_complete)), current_date)
         from project_sprints) + (p_target_months || ' months')::interval as proj_end
  ),
  day_series as (
    select generate_series(proj_start::date, proj_end::date, '1 day'::interval)::date as d
    from window_bounds
  ),
  project_issues as (
    select i.*
    from public.jira_issues i
    where i.tenant_id = p_tenant_id
      and i.issuetype not in ('Sub-task', 'Subtask', 'Epic')
      and (p_project_id is null or i.project_id = p_project_id)
  ),
  created_scope as (
    select i.created_at::date d, sum(coalesce(i.story_points, 0))::numeric delta_scope
    from project_issues i
    group by i.created_at::date
  ),
  done_scope as (
    select cl.changed_at::date d, sum(coalesce(i.story_points, 0))::numeric delta_done
    from public.jira_changelog_entries cl
    join project_issues i on i.jira_key = cl.jira_issue_key
    where cl.tenant_id = p_tenant_id
      and cl.to_status = any(p_done_statuses)
    group by cl.changed_at::date
  ),
  daily as (
    select
      ds.d,
      coalesce(cs.delta_scope, 0) s1,
      coalesce(ds2.delta_done, 0) s2
    from day_series ds
    left join created_scope cs on cs.d = ds.d
    left join done_scope ds2 on ds2.d = ds.d
  ),
  cum as (
    select
      d,
      sum(s1) over (order by d rows between unbounded preceding and current row)::numeric as scope,
      sum(s2) over (order by d rows between unbounded preceding and current row)::numeric as completed
    from daily
  ),
  final as (
    select d, scope, completed, greatest(scope - completed, 0)::numeric as remaining
    from cum
  ),
  final_bounds as (
    select max(scope) peak_scope from final
  ),
  ideal_info as (
    select
      (select min(d) from final) id_start,
      (select max(d) from final) id_end,
      (select peak_scope from final_bounds) peak
  )
  select
    final.d::date as as_of_date,
    final.scope,
    final.completed,
    final.remaining,
    case
      when ideal_info.peak is null or ideal_info.peak = 0 then null
      else
        round(
          ideal_info.peak -
          (ideal_info.peak * greatest(
            (final.d - ideal_info.id_start)::numeric /
            greatest((ideal_info.id_end - ideal_info.id_start), 1)::numeric,
            0
          )),
          2
        )
    end::numeric as ideal
  from final, ideal_info
  where final.d <= (select id_end from ideal_info)
  order by final.d asc;
$$;

revoke execute on function public.kpi_project_burndown(uuid, integer, text[], uuid) from public;
grant  execute on function public.kpi_project_burndown(uuid, integer, text[], uuid) to authenticated, service_role;
;
