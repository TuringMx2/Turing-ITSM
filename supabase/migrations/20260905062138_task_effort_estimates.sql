-- Replace task due dates with optional effort estimates while preserving legacy records.

alter table public.tasks
  add column estimate_quantity numeric(10,2),
  add column estimate_unit text,
  alter column due_date drop not null,
  add constraint tasks_estimate_check check (
    (estimate_quantity is null and estimate_unit is null)
    or (
      estimate_quantity is not null
      and estimate_unit is not null
      and estimate_quantity > 0
      and estimate_unit in ('hours', 'days')
    )
  );

create or replace function public.list_my_cards(
  p_limit integer default 10,
  p_offset integer default 0
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with assigned_tasks as (
    select distinct ta.tenant_id, ta.project_id, ta.task_id
    from public.task_assignees ta
    where ta.user_id = (select auth.uid())
      and ta.tenant_id = private.current_tenant_id()
  ),
  visible_cards as (
    select
      t.id,
      t.project_id,
      t.column_id,
      c.name as column_name,
      t.title,
      t.description,
      t.priority,
      t.estimate_quantity,
      t.estimate_unit,
      t.created_at
    from assigned_tasks assigned
    join public.tasks t
      on t.tenant_id = assigned.tenant_id
     and t.project_id = assigned.project_id
     and t.id = assigned.task_id
    join public.project_workflow_columns c
      on c.tenant_id = t.tenant_id
     and c.project_id = t.project_id
     and c.id = t.column_id
    join public.projects p
      on p.tenant_id = t.tenant_id
     and p.id = t.project_id
    where p.archived_at is null
      and private.can_manage_project(t.tenant_id, t.project_id)
  )
  select jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', page_rows.id,
          'project_id', page_rows.project_id,
          'column_id', page_rows.column_id,
          'column_name', page_rows.column_name,
          'title', page_rows.title,
          'description', page_rows.description,
          'priority', page_rows.priority,
          'estimate_quantity', page_rows.estimate_quantity,
          'estimate_unit', page_rows.estimate_unit,
          'created_at', page_rows.created_at
        )
        order by page_rows.priority_rank desc, page_rows.created_at desc, page_rows.id
      )
      from (
        select
          visible.*,
          case visible.priority
            when 'urgent' then 4
            when 'high' then 3
            when 'medium' then 2
            when 'low' then 1
          end as priority_rank
        from visible_cards visible
        order by priority_rank desc, visible.created_at desc, visible.id
        limit least(greatest(coalesce(p_limit, 10), 1), 100)
        offset greatest(coalesce(p_offset, 0), 0)
      ) page_rows
    ), '[]'::jsonb),
    'count', (select count(*) from visible_cards)
  )
$$;

alter function public.list_my_cards(integer, integer) owner to postgres;
revoke all on function public.list_my_cards(integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.list_my_cards(integer, integer) to authenticated;;
