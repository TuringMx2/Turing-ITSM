-- Active-project write boundaries and transactional task query helpers.

create function private.can_manage_active_project(
  p_tenant_id uuid,
  p_project_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_manage_project(p_tenant_id, p_project_id)
    and exists (
      select 1
      from public.projects p
      where p.tenant_id = p_tenant_id
        and p.id = p_project_id
        and p.archived_at is null
    )
$$;
alter function private.can_manage_active_project(uuid, uuid) owner to postgres;
revoke all on function private.can_manage_active_project(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.can_manage_active_project(uuid, uuid) to authenticated;
drop policy if exists project_workflow_columns_insert_scope
  on public.project_workflow_columns;
drop policy if exists project_workflow_columns_update_scope
  on public.project_workflow_columns;
drop policy if exists project_workflow_columns_delete_scope
  on public.project_workflow_columns;
create policy project_workflow_columns_insert_scope on public.project_workflow_columns
for insert to authenticated
with check (
  private.can_manage_active_project(tenant_id, project_id)
  and created_by = (select auth.uid())
);
create policy project_workflow_columns_update_scope on public.project_workflow_columns
for update to authenticated
using (private.can_manage_active_project(tenant_id, project_id))
with check (private.can_manage_active_project(tenant_id, project_id));
create policy project_workflow_columns_delete_scope on public.project_workflow_columns
for delete to authenticated
using (private.can_manage_active_project(tenant_id, project_id));
drop policy if exists tasks_insert_scope on public.tasks;
drop policy if exists tasks_update_scope on public.tasks;
drop policy if exists tasks_delete_scope on public.tasks;
create policy tasks_insert_scope on public.tasks
for insert to authenticated
with check (
  private.can_manage_active_project(tenant_id, project_id)
  and created_by = (select auth.uid())
);
create policy tasks_update_scope on public.tasks
for update to authenticated
using (private.can_manage_active_project(tenant_id, project_id))
with check (private.can_manage_active_project(tenant_id, project_id));
create policy tasks_delete_scope on public.tasks
for delete to authenticated
using (private.can_manage_active_project(tenant_id, project_id));
drop policy if exists task_assignees_insert_scope on public.task_assignees;
drop policy if exists task_assignees_delete_scope on public.task_assignees;
create policy task_assignees_insert_scope on public.task_assignees
for insert to authenticated
with check (
  private.can_manage_active_project(tenant_id, project_id)
  and assigned_by = (select auth.uid())
);
create policy task_assignees_delete_scope on public.task_assignees
for delete to authenticated
using (private.can_manage_active_project(tenant_id, project_id));
drop policy if exists task_comments_insert_scope on public.task_comments;
create policy task_comments_insert_scope on public.task_comments
for insert to authenticated
with check (
  private.can_manage_active_project(tenant_id, project_id)
  and author_user_id = (select auth.uid())
);
drop policy if exists task_attachments_insert_scope on public.task_attachments;
drop policy if exists task_attachments_delete_scope on public.task_attachments;
create policy task_attachments_insert_scope on public.task_attachments
for insert to authenticated
with check (
  private.can_manage_active_project(tenant_id, project_id)
  and uploaded_by = (select auth.uid())
  and bucket = 'task-attachments'
);
create policy task_attachments_delete_scope on public.task_attachments
for delete to authenticated
using (private.can_manage_active_project(tenant_id, project_id));
drop policy if exists task_attachment_objects_insert on storage.objects;
drop policy if exists task_attachment_objects_delete on storage.objects;
create policy task_attachment_objects_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'task-attachments'
  and exists (
    select 1
    from public.task_attachments a
    where a.storage_path = storage.objects.name
      and a.uploaded_by = (select auth.uid())
      and private.can_manage_active_project(a.tenant_id, a.project_id)
  )
);
create policy task_attachment_objects_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'task-attachments'
  and exists (
    select 1
    from public.task_attachments a
    where a.storage_path = storage.objects.name
      and private.can_manage_active_project(a.tenant_id, a.project_id)
  )
);
create function public.replace_task_assignees(
  p_task_id uuid,
  p_assignee_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_project_id uuid;
  v_assignee_ids uuid[];
  v_member_count integer;
begin
  if (select auth.uid()) is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required';
  end if;

  if exists (
    select 1
    from unnest(coalesce(p_assignee_ids, '{}'::uuid[])) requested(user_id)
    where requested.user_id is null
  ) then
    raise exception using
      errcode = '22004',
      message = 'Assignee identifiers cannot be null';
  end if;

  select coalesce(array_agg(deduplicated.user_id order by deduplicated.user_id), '{}'::uuid[])
  into v_assignee_ids
  from (
    select distinct requested.user_id
    from unnest(coalesce(p_assignee_ids, '{}'::uuid[])) requested(user_id)
  ) deduplicated;

  if cardinality(v_assignee_ids) > 100 then
    raise exception using
      errcode = '22023',
      message = 'A task cannot have more than 100 assignees';
  end if;

  select t.tenant_id, t.project_id
  into v_tenant_id, v_project_id
  from public.tasks t
  join public.projects p
    on p.tenant_id = t.tenant_id
   and p.id = t.project_id
  where t.id = p_task_id
    and private.can_manage_active_project(t.tenant_id, t.project_id)
  for update of t, p;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'Task not found or active project access denied';
  end if;

  select count(*)::integer
  into v_member_count
  from public.project_memberships pm
  where pm.tenant_id = v_tenant_id
    and pm.project_id = v_project_id
    and pm.user_id = any(v_assignee_ids);

  if v_member_count <> cardinality(v_assignee_ids) then
    raise exception using
      errcode = '23503',
      message = 'Every assignee must be a current project member';
  end if;

  delete from public.task_assignees ta
  where ta.tenant_id = v_tenant_id
    and ta.project_id = v_project_id
    and ta.task_id = p_task_id;

  insert into public.task_assignees (
    tenant_id,
    project_id,
    task_id,
    user_id,
    assigned_by
  )
  select
    v_tenant_id,
    v_project_id,
    p_task_id,
    requested.user_id,
    (select auth.uid())
  from unnest(v_assignee_ids) requested(user_id);
end;
$$;
alter function public.replace_task_assignees(uuid, uuid[]) owner to postgres;
revoke all on function public.replace_task_assignees(uuid, uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.replace_task_assignees(uuid, uuid[]) to authenticated;
create function public.list_my_cards(
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
      t.due_date,
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
          'due_date', page_rows.due_date,
          'created_at', page_rows.created_at
        )
        order by page_rows.priority_rank desc, page_rows.due_date, page_rows.created_at desc, page_rows.id
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
        order by priority_rank desc, visible.due_date, visible.created_at desc, visible.id
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
grant execute on function public.list_my_cards(integer, integer) to authenticated;
