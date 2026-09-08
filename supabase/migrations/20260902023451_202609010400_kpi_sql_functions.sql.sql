-- Monotoli: KPI SQL Functions
-- Funciones agregadas en Postgres para burndown, velocity y SP summaries.
-- Paridad con sprint-kpi/pipeline/helpers.py y charts/*.py.
-- Todas tenant-scoped por argumento o RLS.

-- -----------------------------------------------------------------------------
-- kpi_sprint_burndown:
--   Dado un sprint Jira (tenant_id + jira_sprint_id), devuelve la serie diaria
--   {date, scope, completed, remaining} necesaria para la gráfica de burndown
--   de sprint. Usa jira_changelog_entries (primera fecha en que cada issue
--   llegó a Done) + jira_issues para la foto actual.
-- -----------------------------------------------------------------------------
create or replace function public.kpi_sprint_burndown(
  p_tenant_id uuid,
  p_sprint_jira_id integer,
  p_done_statuses text[] default array['Done', 'Cerrado', 'Listo', 'Closed', 'Completado']
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
    where s.tenant_id = p_tenant_id and s.jira_id = p_sprint_jira_id
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
        )
      end as done_on
    from public.jira_issues i
    where i.tenant_id = p_tenant_id and i.jira_sprint_id = p_sprint_jira_id
      and i.issuetype not in ('Sub-task', 'Subtask', 'Epic')
  ),
  date_range as (
    select generate_series(
      (select sprint_start from sprint_meta),
      greatest((select sprint_end from sprint_meta), current_date),
      interval '1 day'
    )::date as d
  ),
  scope_cum as (
    select d.d as the_date, coalesce(sum(i.story_points), 0) as delta_scope
    from date_range d
    left join sprint_issues i on i.created_on = d.d
    group by d.d
  ),
  completed_cum as (
    select d.d as the_date, coalesce(sum(i.story_points), 0) as delta_done
    from date_range d
    left join sprint_issues i on i.done_on = d.d
    group by d.d
  )
  select
    sc.the_date,
    coalesce(sum(sc.delta_scope) over w, 0)::numeric as scope,
    coalesce(sum(cc.delta_done) over w, 0)::numeric as completed,
    (
      coalesce(sum(sc.delta_scope) over w, 0) - coalesce(sum(cc.delta_done) over w, 0)
    )::numeric as remaining
  from scope_cum sc
  join completed_cum cc on cc.the_date = sc.the_date
  window w as (order by sc.the_date rows between unbounded preceding and current row)
  order by sc.the_date;
$$;

-- -----------------------------------------------------------------------------
-- kpi_velocity_summary:
--   Velocity (SP completados / sprint) para los últimos N sprints cerrados
--   de un board. Devuelve avg, total sprints y array de valores individuales.
-- -----------------------------------------------------------------------------
create or replace function public.kpi_velocity_summary(
  p_tenant_id uuid,
  p_board_jira_id integer,
  p_last_n integer default 8,
  p_done_statuses text[] default array['Done', 'Cerrado', 'Listo', 'Closed', 'Completado']
)
returns table (
  sprint_jira_id integer,
  sprint_name text,
  completed_sp numeric,
  avg_sp numeric,
  total_sprints bigint
)
language sql
stable
set search_path = ''
as $$
  with closed_sprints as (
    select s.jira_id, s.name
    from public.jira_sprints s
    where s.tenant_id = p_tenant_id
      and s.jira_board_id = p_board_jira_id
      and s.state = 'closed'
    order by s.complete_date desc nulls last, s.end_date desc nulls last
    limit p_last_n
  ),
  sprint_sp as (
    select
      cs.jira_id,
      cs.name,
      coalesce(sum(i.story_points) filter (where i.resolved), 0)::numeric as done_sp
    from closed_sprints cs
    left join public.jira_issues i
      on i.tenant_id = p_tenant_id and i.jira_sprint_id = cs.jira_id
      and i.issuetype not in ('Sub-task', 'Subtask', 'Epic')
    group by cs.jira_id, cs.name
  )
  select
    jira_id,
    name,
    done_sp,
    round((avg(done_sp) over ())::numeric, 2) as avg_sp,
    (count(*) over ())::bigint as total_sprints
  from sprint_sp
  order by done_sp desc;
$$;

-- -----------------------------------------------------------------------------
-- kpi_assigned_sp_by_member:
--   SP asignados (activos + cerrados) por persona, en un sprint o board.
--   Equivalente a helpers.get_sp_per_member() + get_pct_sp_per_member().
-- -----------------------------------------------------------------------------
create or replace function public.kpi_assigned_sp_by_member(
  p_tenant_id uuid,
  p_board_jira_id integer default null,
  p_sprint_jira_id integer default null
)
returns table (
  assignee_display_name text,
  assignee_email text,
  total_issues bigint,
  total_sp numeric,
  resolved_issues bigint,
  resolved_sp numeric,
  pct_of_total_sp numeric
)
language sql
stable
set search_path = ''
as $$
  with candidate_issues as (
    select i.*
    from public.jira_issues i
    join public.jira_sprints s
      on s.tenant_id = p_tenant_id and s.jira_id = i.jira_sprint_id
    where i.tenant_id = p_tenant_id
      and i.issuetype not in ('Sub-task', 'Subtask', 'Epic')
      and (p_board_jira_id is null or s.jira_board_id = p_board_jira_id)
      and (p_sprint_jira_id is null or i.jira_sprint_id = p_sprint_jira_id)
  ),
  totals as (
    select coalesce(sum(coalesce(story_points, 0)), 0)::numeric as all_sp
    from candidate_issues
  ),
  by_member as (
    select
      coalesce(i.assignee_display_name, 'Sin asignar') as assignee_display_name,
      coalesce(i.assignee_email, '') as assignee_email,
      count(*) as total_issues,
      coalesce(sum(coalesce(i.story_points, 0)), 0)::numeric as total_sp,
      count(*) filter (where i.resolved) as resolved_issues,
      coalesce(sum(coalesce(i.story_points, 0)) filter (where i.resolved), 0)::numeric as resolved_sp
    from candidate_issues i
    group by coalesce(i.assignee_display_name, 'Sin asignar'), coalesce(i.assignee_email, '')
  )
  select
    bm.assignee_display_name,
    bm.assignee_email,
    bm.total_issues,
    bm.total_sp,
    bm.resolved_issues,
    bm.resolved_sp,
    round(
      case when t.all_sp = 0 then 0 else (bm.total_sp / t.all_sp) * 100 end,
      2
    ) as pct_of_total_sp
  from by_member bm
  cross join totals t
  order by bm.total_sp desc;
$$;

-- -----------------------------------------------------------------------------
-- kpi_sp_completed_over_time:
--   Serie temporal (granularidad D/W/M) de SP completados, para chart
--   sp_completed y closed_cards.
-- -----------------------------------------------------------------------------
create or replace function public.kpi_sp_completed_over_time(
  p_tenant_id uuid,
  p_board_jira_id integer default null,
  p_granularity text default 'W'  -- 'D', 'W', or 'M'
)
returns table (
  bucket_start date,
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
    where i.tenant_id = p_tenant_id
      and i.resolved
      and i.issuetype not in ('Sub-task', 'Subtask', 'Epic')
      and (p_board_jira_id is null or s.jira_board_id = p_board_jira_id)
      and i.resolution_date is not null
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
    b.bucket_start,
    coalesce(sum(b.sp), 0)::numeric as completed_sp,
    coalesce(sum(b.cnt), 0)::bigint as completed_issues
  from bucketed b
  group by b.bucket_start
  order by b.bucket_start asc;
$$;

-- -----------------------------------------------------------------------------
-- kpi_cloud_costs_pivot:
--   Gastos cloud pivotados por período y servicio, listos para alimentar
--   el stacked bar chart de CloudExpensesChart.
-- -----------------------------------------------------------------------------
create or replace function public.kpi_cloud_costs_pivot(
  p_tenant_id uuid,
  p_granularity text default 'M',  -- 'D', 'W', 'M'
  p_currency text default 'USD',   -- 'USD' o 'MXN'
  p_from_date date default null,
  p_to_date date default null
)
returns table (
  bucket_start date,
  service_name text,
  provider_name text,
  cost numeric,
  total_per_bucket numeric
)
language sql
stable
set search_path = ''
as $$
  with filtered as (
    select e.*
    from public.cloud_cost_entries e
    where e.tenant_id = p_tenant_id
      and (p_from_date is null or e.date >= p_from_date)
      and (p_to_date is null or e.date <= p_to_date)
  ),
  bucketed as (
    select
      case upper(p_granularity)
        when 'D' then date_trunc('day', f.date)::date
        when 'W' then date_trunc('week', f.date)::date
        else date_trunc('month', f.date)::date
      end as bucket_start,
      f.service_name,
      f.provider_name,
      case upper(p_currency)
        when 'MXN' then coalesce(f.cost_mxn, 0)
        else coalesce(f.cost_usd, 0)
      end as cost
    from filtered f
  ),
  totals as (
    select bucket_start, sum(cost) as total_per_b
    from bucketed
    group by bucket_start
  )
  select
    b.bucket_start,
    b.service_name,
    b.provider_name,
    round(coalesce(sum(b.cost), 0), 2)::numeric as cost,
    round(coalesce(t.total_per_b, 0), 2)::numeric as total_per_bucket
  from bucketed b
  left join totals t on t.bucket_start = b.bucket_start
  group by b.bucket_start, b.service_name, b.provider_name, t.total_per_b
  order by b.bucket_start asc, b.service_name asc;
$$;

-- -----------------------------------------------------------------------------
-- kpi_daily_annotations_for_sprint:
--   Cruce Jira sprint ↔ Daily submissions (Fase 5).
--   Devuelve, por cada miembro del team asociado al sprint, las respuestas
--   daily enviadas entre sprint_start y sprint_end.
-- -----------------------------------------------------------------------------
create or replace function public.kpi_daily_annotations_for_sprint(
  p_tenant_id uuid,
  p_team_id uuid,
  p_sprint_start date,
  p_sprint_end date
)
returns table (
  user_id uuid,
  user_display_name text,
  user_email text,
  local_date date,
  run_id uuid,
  answers jsonb
)
language sql
stable
set search_path = ''
as $$
  select
    p.id as user_id,
    coalesce(p.full_name, p.email) as user_display_name,
    p.email as user_email,
    r.local_date,
    r.id as run_id,
    jsonb_agg(
      jsonb_build_object(
        'questionId', a.question_id::text,
        'questionText', a.question_text,
        'answerText', a.answer_text
      )
      order by a.created_at asc
    ) as answers
  from public.daily_runs r
  join public.daily_submission_runs sr
    on sr.tenant_id = p_tenant_id and sr.run_id = r.id
  join public.daily_submissions s
    on s.tenant_id = p_tenant_id and s.id = sr.submission_id and s.user_id = sr.user_id
  join public.daily_submission_answers a
    on a.tenant_id = p_tenant_id and a.submission_id = s.id
  join public.profiles p
    on p.tenant_id = p_tenant_id and p.id = s.user_id
  where r.tenant_id = p_tenant_id
    and r.team_id = p_team_id
    and r.local_date between p_sprint_start and p_sprint_end
  group by p.id, coalesce(p.full_name, p.email), p.email, r.local_date, r.id
  order by r.local_date asc, user_display_name asc;
$$;

revoke execute on function public.kpi_sprint_burndown(uuid, integer, text[]) from public;
revoke execute on function public.kpi_velocity_summary(uuid, integer, integer, text[]) from public;
revoke execute on function public.kpi_assigned_sp_by_member(uuid, integer, integer) from public;
revoke execute on function public.kpi_sp_completed_over_time(uuid, integer, text) from public;
revoke execute on function public.kpi_cloud_costs_pivot(uuid, text, text, date, date) from public;
revoke execute on function public.kpi_daily_annotations_for_sprint(uuid, uuid, date, date) from public;

grant execute on function public.kpi_sprint_burndown(uuid, integer, text[]) to authenticated, service_role;
grant execute on function public.kpi_velocity_summary(uuid, integer, integer, text[]) to authenticated, service_role;
grant execute on function public.kpi_assigned_sp_by_member(uuid, integer, integer) to authenticated, service_role;
grant execute on function public.kpi_sp_completed_over_time(uuid, integer, text) to authenticated, service_role;
grant execute on function public.kpi_cloud_costs_pivot(uuid, text, text, date, date) to authenticated, service_role;
grant execute on function public.kpi_daily_annotations_for_sprint(uuid, uuid, date, date) to authenticated, service_role;
;
